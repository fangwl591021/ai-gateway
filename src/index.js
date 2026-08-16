import { buildRoute, inferRegion } from "./routing.js";
import { runProvider } from "./providers/index.js";
import { calculateBillable, calculateProviderCost } from "./billing.js";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, "cache-control": "no-store" },
  });
}

function requestId(request) {
  return request.headers.get("cf-ray") || crypto.randomUUID();
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function authenticate(request, env) {
  if (!env.DB) {
    return { ok: false, response: json({ error: "gateway_not_configured", message: "D1 binding DB is not configured yet." }, 503) };
  }
  const auth = request.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return { ok: false, response: json({ error: "missing_api_key" }, 401) };
  const rawKey = auth.slice(7).trim();
  if (!rawKey.startsWith("agw_")) return { ok: false, response: json({ error: "invalid_api_key" }, 401) };

  const keyHash = await sha256Hex(rawKey);
  const row = await env.DB.prepare(
    `SELECT k.id AS api_key_id, k.tenant_id, k.status, t.name AS tenant_name, t.status AS tenant_status
     FROM api_keys k JOIN tenants t ON t.id = k.tenant_id
     WHERE k.key_hash = ?1 LIMIT 1`
  ).bind(keyHash).first();

  if (!row || row.status !== "active" || row.tenant_status !== "active") {
    return { ok: false, response: json({ error: "invalid_api_key" }, 401) };
  }
  return { ok: true, principal: row };
}

async function parseJson(request) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return { ok: false, response: json({ error: "content_type_must_be_json" }, 415) };
  try { return { ok: true, body: await request.json() }; }
  catch { return { ok: false, response: json({ error: "invalid_json" }, 400) }; }
}

async function updateUsage(env, eventId, data) {
  await env.DB.prepare(
    `UPDATE usage_events SET
      provider = ?2,
      provider_model = ?3,
      status = ?4,
      input_units = ?5,
      output_units = ?6,
      image_count = ?7,
      provider_cost_usd = ?8,
      provider_cost_cny = ?9,
      billable_amount_twd = ?10,
      latency_ms = ?11,
      error_code = ?12,
      completed_at = datetime('now')
     WHERE id = ?1`
  ).bind(
    eventId,
    data.provider,
    data.model,
    data.status,
    data.usage?.inputUnits || 0,
    data.usage?.outputUnits || 0,
    data.usage?.imageCount || 0,
    data.cost?.currency === "USD" ? data.cost.amount : 0,
    data.cost?.currency === "CNY" ? data.cost.amount : 0,
    data.billableAmountTwd || 0,
    data.latencyMs || 0,
    data.errorCode || null
  ).run();
}

async function handleRun(request, env, ctx) {
  const id = requestId(request);
  const auth = await authenticate(request, env);
  if (!auth.ok) return auth.response;

  const parsed = await parseJson(request);
  if (!parsed.ok) return parsed.response;
  const { task, input, region: requestedRegion, metadata = {} } = parsed.body || {};
  if (typeof task !== "string" || !task) return json({ error: "task_required", request_id: id }, 400);
  if (input === undefined || input === null) return json({ error: "input_required", request_id: id }, 400);

  const region = inferRegion(request, requestedRegion);
  const route = buildRoute(task, region);
  const eventId = crypto.randomUUID();
  const startedAt = Date.now();

  await env.DB.prepare(
    `INSERT INTO usage_events
      (id, tenant_id, api_key_id, request_id, task, region, provider, provider_model, status, metadata_json, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'processing', ?9, datetime('now'))`
  ).bind(eventId, auth.principal.tenant_id, auth.principal.api_key_id, id, task, region, route[0].provider, route[0].model, JSON.stringify(metadata)).run();

  ctx.waitUntil(env.DB.prepare(`UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?1`).bind(auth.principal.api_key_id).run());

  const attempts = [];
  for (const candidate of route) {
    const attemptStarted = Date.now();
    try {
      const providerResult = await runProvider({ env, region, task, input, ...candidate });
      const cost = await calculateProviderCost(env, {
        provider: candidate.provider,
        model: candidate.model,
        region,
        usage: providerResult.usage,
      });
      const billableAmountTwd = await calculateBillable(env, {
        tenantId: auth.principal.tenant_id,
        task,
        providerCostTwd: cost.twd,
      });
      const latencyMs = Date.now() - startedAt;

      await updateUsage(env, eventId, {
        provider: candidate.provider,
        model: candidate.model,
        status: "success",
        usage: providerResult.usage,
        cost,
        billableAmountTwd,
        latencyMs,
      });

      console.log(JSON.stringify({ event: "gateway_request_success", request_id: id, tenant_id: auth.principal.tenant_id, task, region, provider: candidate.provider, model: candidate.model, latency_ms: latencyMs }));

      return json({
        request_id: id,
        status: "success",
        task,
        region,
        provider: candidate.provider,
        model: candidate.model,
        provider_request_id: providerResult.providerRequestId || null,
        result: providerResult.result,
        usage: {
          input_units: providerResult.usage?.inputUnits || 0,
          output_units: providerResult.usage?.outputUnits || 0,
          image_count: providerResult.usage?.imageCount || 0,
          provider_cost: cost.amount,
          provider_currency: cost.currency,
          provider_cost_twd: Number(cost.twd.toFixed(6)),
          billable_amount_twd: Number(billableAmountTwd.toFixed(6)),
          priced: cost.priced,
        },
        attempts,
      });
    } catch (error) {
      attempts.push({
        provider: candidate.provider,
        model: candidate.model,
        code: error?.code || "provider_error",
        duration_ms: Date.now() - attemptStarted,
      });
    }
  }

  const latencyMs = Date.now() - startedAt;
  const last = attempts[attempts.length - 1];
  await updateUsage(env, eventId, {
    provider: last?.provider || route[0].provider,
    model: last?.model || route[0].model,
    status: "failed",
    usage: {},
    cost: { amount: 0, currency: null },
    billableAmountTwd: 0,
    latencyMs,
    errorCode: last?.code || "all_providers_failed",
  });

  return json({ error: "all_providers_failed", request_id: id, attempts }, 502);
}

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/health") {
        return json({
          ok: true,
          service: "ai-gateway",
          version: "0.2.0",
          environment: env.ENVIRONMENT || "unknown",
          d1_configured: Boolean(env.DB),
          qwen_cn_configured: Boolean(env.QWEN_CN_API_KEY && env.QWEN_CN_WORKSPACE_ID),
          qwen_intl_configured: Boolean(env.QWEN_INTL_API_KEY && env.QWEN_INTL_WORKSPACE_ID),
          timestamp: new Date().toISOString(),
        });
      }
      if (request.method === "POST" && url.pathname === "/v1/run") return await handleRun(request, env, ctx);
      if (request.method === "GET" && url.pathname === "/") {
        return json({ service: "AI Gateway", status: "online", version: "0.2.0", endpoints: ["GET /health", "POST /v1/run"] });
      }
      return json({ error: "not_found" }, 404);
    } catch (error) {
      const id = requestId(request);
      console.error(JSON.stringify({ event: "unhandled_error", request_id: id, message: error instanceof Error ? error.message : String(error) }));
      return json({ error: "internal_error", request_id: id }, 500);
    }
  },
};
