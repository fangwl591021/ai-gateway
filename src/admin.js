function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function adminAuthorized(request, env) {
  const supplied = request.headers.get("x-admin-key") || "";
  return Boolean(env.ADMIN_API_KEY && supplied && supplied === env.ADMIN_API_KEY);
}

function monthRange(month) {
  if (!/^\d{4}-\d{2}$/.test(month || "")) return null;
  const [year, mon] = month.split("-").map(Number);
  if (mon < 1 || mon > 12) return null;
  const start = `${year}-${String(mon).padStart(2, "0")}-01 00:00:00`;
  const nextYear = mon === 12 ? year + 1 : year;
  const nextMon = mon === 12 ? 1 : mon + 1;
  const end = `${nextYear}-${String(nextMon).padStart(2, "0")}-01 00:00:00`;
  return { start, end };
}

async function dashboard(env, month) {
  const range = monthRange(month);
  if (!range) return json({ error: "invalid_month", expected: "YYYY-MM" }, 400);

  const totals = await env.DB.prepare(`
    SELECT
      COUNT(*) AS requests,
      SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS successes,
      SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failures,
      COALESCE(SUM(provider_cost_usd),0) AS provider_cost_usd,
      COALESCE(SUM(provider_cost_cny),0) AS provider_cost_cny,
      COALESCE(SUM(billable_amount_twd),0) AS revenue_twd,
      COALESCE(SUM(image_count),0) AS images
    FROM usage_events WHERE created_at >= ?1 AND created_at < ?2
  `).bind(range.start, range.end).first();

  const tenants = await env.DB.prepare(`
    SELECT t.id, t.name,
      COUNT(u.id) AS requests,
      COALESCE(SUM(u.billable_amount_twd),0) AS revenue_twd,
      COALESCE(SUM(u.provider_cost_usd),0) AS provider_cost_usd,
      COALESCE(SUM(u.provider_cost_cny),0) AS provider_cost_cny,
      COALESCE(SUM(u.image_count),0) AS images
    FROM tenants t
    LEFT JOIN usage_events u ON u.tenant_id=t.id AND u.created_at >= ?1 AND u.created_at < ?2
    GROUP BY t.id, t.name ORDER BY revenue_twd DESC
  `).bind(range.start, range.end).all();

  const usdTwd = Number(env.USD_TWD_RATE || 30);
  const cnyTwd = Number(env.CNY_TWD_RATE || 4.75);
  const providerCostTwd = Number(totals.provider_cost_usd || 0) * usdTwd + Number(totals.provider_cost_cny || 0) * cnyTwd;
  const revenueTwd = Number(totals.revenue_twd || 0);

  return json({
    month,
    totals: {
      ...totals,
      provider_cost_twd: Number(providerCostTwd.toFixed(2)),
      revenue_twd: Number(revenueTwd.toFixed(2)),
      gross_profit_twd: Number((revenueTwd-providerCostTwd).toFixed(2)),
      gross_margin_percent: revenueTwd > 0 ? Number((((revenueTwd-providerCostTwd)/revenueTwd)*100).toFixed(2)) : 0,
    },
    tenants: (tenants.results || []).map((row) => {
      const cost = Number(row.provider_cost_usd || 0)*usdTwd + Number(row.provider_cost_cny || 0)*cnyTwd;
      const revenue = Number(row.revenue_twd || 0);
      return { ...row, provider_cost_twd: Number(cost.toFixed(2)), gross_profit_twd: Number((revenue-cost).toFixed(2)) };
    }),
  });
}

async function tenantUsage(env, tenantId, month) {
  const range = monthRange(month);
  if (!range) return json({ error: "invalid_month", expected: "YYYY-MM" }, 400);
  const tenant = await env.DB.prepare(`SELECT id,name,status,billing_mode,currency,markup_percent FROM tenants WHERE id=?1 LIMIT 1`).bind(tenantId).first();
  if (!tenant) return json({ error: "tenant_not_found" }, 404);
  const byTask = await env.DB.prepare(`
    SELECT task, provider, provider_model, COUNT(*) AS requests,
      SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS successes,
      COALESCE(SUM(image_count),0) AS images,
      COALESCE(SUM(provider_cost_usd),0) AS provider_cost_usd,
      COALESCE(SUM(provider_cost_cny),0) AS provider_cost_cny,
      COALESCE(SUM(billable_amount_twd),0) AS billable_amount_twd
    FROM usage_events WHERE tenant_id=?1 AND created_at>=?2 AND created_at<?3
    GROUP BY task,provider,provider_model ORDER BY billable_amount_twd DESC
  `).bind(tenantId, range.start, range.end).all();
  return json({ tenant, month, usage: byTask.results || [] });
}

async function createInvoice(env, tenantId, month) {
  const range = monthRange(month);
  if (!range) return json({ error: "invalid_month" }, 400);
  const usage = await env.DB.prepare(`SELECT COALESCE(SUM(billable_amount_twd),0) AS amount FROM usage_events WHERE tenant_id=?1 AND status='success' AND created_at>=?2 AND created_at<?3`).bind(tenantId, range.start, range.end).first();
  const sub = await env.DB.prepare(`SELECT p.monthly_fee_twd,p.included_credits_twd FROM tenant_subscriptions s JOIN plans p ON p.id=s.plan_id WHERE s.tenant_id=?1 AND s.status='active' LIMIT 1`).bind(tenantId).first();
  const usageAmount = Number(usage?.amount || 0);
  const monthlyFee = Number(sub?.monthly_fee_twd || 0);
  const credits = Math.min(usageAmount, Number(sub?.included_credits_twd || 0));
  const subtotal = Math.max(0, monthlyFee + usageAmount - credits);
  const tax = 0;
  const total = subtotal + tax;
  const id = `inv_${month.replace('-', '')}_${tenantId}`;
  await env.DB.prepare(`INSERT OR REPLACE INTO invoices (id,tenant_id,period_start,period_end,usage_amount_twd,monthly_fee_twd,credits_twd,subtotal_twd,tax_twd,total_twd,status,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,'draft',datetime('now'))`).bind(id,tenantId,range.start,range.end,usageAmount,monthlyFee,credits,subtotal,tax,total).run();
  return json({ invoice: { id, tenant_id: tenantId, month, usage_amount_twd: usageAmount, monthly_fee_twd: monthlyFee, credits_twd: credits, subtotal_twd: subtotal, tax_twd: tax, total_twd: total, status: "draft" } }, 201);
}

export async function handleAdmin(request, env, url) {
  if (!adminAuthorized(request, env)) return json({ error: "admin_unauthorized" }, 401);
  const month = url.searchParams.get("month") || new Date().toISOString().slice(0,7);
  if (request.method === "GET" && url.pathname === "/admin/dashboard") return dashboard(env, month);
  const usageMatch = url.pathname.match(/^\/admin\/tenants\/([^/]+)\/usage$/);
  if (request.method === "GET" && usageMatch) return tenantUsage(env, decodeURIComponent(usageMatch[1]), month);
  const invoiceMatch = url.pathname.match(/^\/admin\/tenants\/([^/]+)\/invoices$/);
  if (request.method === "POST" && invoiceMatch) return createInvoice(env, decodeURIComponent(invoiceMatch[1]), month);
  if (request.method === "GET" && url.pathname === "/admin/invoices") {
    const rows = await env.DB.prepare(`SELECT i.*,t.name AS tenant_name FROM invoices i JOIN tenants t ON t.id=i.tenant_id ORDER BY period_start DESC,tenant_name`).all();
    return json({ invoices: rows.results || [] });
  }
  return json({ error: "admin_not_found" }, 404);
}
