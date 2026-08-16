const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...JSON_HEADERS,
      "cache-control": "no-store",
    },
  });
}

function requestId(request) {
  return request.headers.get("cf-ray") || crypto.randomUUID();
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function inferRegion(request, requestedRegion) {
  if (requestedRegion === "cn" || requestedRegion === "global") return requestedRegion;
  const country = request.cf?.country;
  return country === "CN" ? "cn" : "global";
}

function routeTask(task, region) {
  if (region === "cn") {
    if (task === "image.tryon.glasses" || task === "image.hairstyle") {
      return { provider: "qwen", capability: "image-edit-high-quality", mode: "primary" };
    }
    if (task.startsWith("vision.")) {
      return { provider: "qwen", capability: "vision", mode: "primary" };
    }
    return { provider: "qwen", capability: "text", mode: "primary" };
  }

  if (task === "image.tryon.glasses" || task === "image.hairstyle") {
    return { provider: "openai", capability: "image-edit-high-quality", mode: "primary" };
  }
  if (task.startsWith("vision.")) {
    return { provider: "gemini", capability: "vision", mode: "primary" };
  }
  return { provider: "openai", capability: "text", mode: "primary" };
}

async function authenticate(request, env) {
  if (!env.DB) {
    return { ok: false, response: json({ error: "gateway_not_configured", message: "D1 binding DB is not configured yet." }, 503) };
  }

  const auth = request.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) {
    return { ok: false, response: json({ error: "missing_api_key" }, 401) };
  }

  const rawKey = auth.slice(7).trim();
  if (!rawKey.startsWith("agw_")) {
    return { ok: false, response: json({ error: "invalid_api_key" }, 401) };
  }

  const keyHash = await sha256Hex(rawKey);
  const row = await env.DB.prepare(
    `SELECT k.id AS api_key_id, k.tenant_id, k.status, t.name AS tenant_name, t.status AS tenant_status
     FROM api_keys k
     JOIN tenants t ON t.id = k.tenant_id
     WHERE k.key_hash = ?1
     LIMIT 1`
  ).bind(keyHash).first();

  if (!row || row.status !== "active" || row.tenant_status !== "active") {
    return { ok: false, response: json({ error: "invalid_api_key" }, 401) };
  }

  return { ok: true, principal: row };
}

async function parseJson(request) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return { ok: false, response: json({ error: "content_type_must_be_json" }, 415) };
  }

  try {
    return { ok: true, body: await request.json() };
  } catch {
    return { ok: false, response: json({ error: "invalid_json" }, 400) };
  }
}

async function handleRun(request, env, ctx) {
  const id = requestId(request);
  const auth = await authenticate(request, env);
  if (!auth.ok) return auth.response;

  const parsed = await parseJson(request);
  if (!parsed.ok) return parsed.response;

  const { task, input, region: requestedRegion, metadata = {} } = parsed.body || {};
  if (typeof task !== "string" || !task) {
    return json({ error: "task_required", request_id: id }, 400);
  }
  if (input === undefined || input === null) {
    return json({ error: "input_required", request_id: id }, 400);
  }

  const region = inferRegion(request, requestedRegion);
  const route = routeTask(task, region);
  const eventId = crypto.randomUUID();
  const startedAt = Date.now();

  await env.DB.prepare(
    `INSERT INTO usage_events
      (id, tenant_id, api_key_id, request_id, task, region, provider, provider_model, status, input_units, output_units, provider_cost_usd, billable_amount_twd, metadata_json, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'accepted', 0, 0, 0, 0, ?9, datetime('now'))`
  ).bind(
    eventId,
    auth.principal.tenant_id,
    auth.principal.api_key_id,
    id,
    task,
    region,
    route.provider,
    route.capability,
    JSON.stringify(metadata)
  ).run();

  ctx.waitUntil(
    env.DB.prepare(
      `UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?1`
    ).bind(auth.principal.api_key_id).run()
  );

  console.log(JSON.stringify({
    event: "gateway_request_accepted",
    request_id: id,
    tenant_id: auth.principal.tenant_id,
    task,
    region,
    provider: route.provider,
    duration_ms: Date.now() - startedAt,
  }));

  return json({
    request_id: id,
    status: "accepted",
    task,
    region,
    route,
    tenant: {
      id: auth.principal.tenant_id,
      name: auth.principal.tenant_name,
    },
    note: "Phase 1 routing is active. Provider adapters will be connected in Phase 2.",
  }, 202);
}

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      if (request.method === "GET" && url.pathname === "/health") {
        return json({
          ok: true,
          service: "ai-gateway",
          version: "0.1.0",
          environment: env.ENVIRONMENT || "unknown",
          d1_configured: Boolean(env.DB),
          timestamp: new Date().toISOString(),
        });
      }

      if (request.method === "POST" && url.pathname === "/v1/run") {
        return await handleRun(request, env, ctx);
      }

      if (request.method === "GET" && url.pathname === "/") {
        return json({
          service: "AI Gateway",
          status: "online",
          endpoints: ["GET /health", "POST /v1/run"],
        });
      }

      return json({ error: "not_found" }, 404);
    } catch (error) {
      const id = requestId(request);
      console.error(JSON.stringify({
        event: "unhandled_error",
        request_id: id,
        message: error instanceof Error ? error.message : String(error),
      }));
      return json({ error: "internal_error", request_id: id }, 500);
    }
  },
};
