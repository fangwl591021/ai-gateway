function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function adminAuthorized(request, env) {
  const supplied = request.headers.get("x-admin-key") || "";
  if (!env.ADMIN_API_KEY || !supplied) return false;
  const enc = new TextEncoder();
  const a = enc.encode(supplied);
  const b = enc.encode(env.ADMIN_API_KEY);
  if (a.byteLength !== b.byteLength) return false;
  return crypto.subtle.timingSafeEqual(a, b);
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

async function parseJson(request) {
  try { return await request.json(); } catch { return null; }
}

function randomToken(bytes = 24) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function dashboard(env, month) {
  const range = monthRange(month);
  if (!range) return json({ error: "invalid_month", expected: "YYYY-MM" }, 400);
  const totals = await env.DB.prepare(`SELECT COUNT(*) AS requests,SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS successes,SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failures,COALESCE(SUM(provider_cost_usd),0) AS provider_cost_usd,COALESCE(SUM(provider_cost_cny),0) AS provider_cost_cny,COALESCE(SUM(billable_amount_twd),0) AS revenue_twd,COALESCE(SUM(image_count),0) AS images FROM usage_events WHERE created_at>=?1 AND created_at<?2`).bind(range.start, range.end).first();
  const tenants = await env.DB.prepare(`SELECT t.id,t.name,t.status,t.billing_mode,t.markup_percent,COUNT(u.id) AS requests,COALESCE(SUM(u.billable_amount_twd),0) AS revenue_twd,COALESCE(SUM(u.provider_cost_usd),0) AS provider_cost_usd,COALESCE(SUM(u.provider_cost_cny),0) AS provider_cost_cny,COALESCE(SUM(u.image_count),0) AS images FROM tenants t LEFT JOIN usage_events u ON u.tenant_id=t.id AND u.created_at>=?1 AND u.created_at<?2 GROUP BY t.id,t.name,t.status,t.billing_mode,t.markup_percent ORDER BY revenue_twd DESC`).bind(range.start, range.end).all();
  const usdTwd = Number(env.USD_TWD_RATE || 30), cnyTwd = Number(env.CNY_TWD_RATE || 4.75);
  const providerCostTwd = Number(totals.provider_cost_usd || 0)*usdTwd + Number(totals.provider_cost_cny || 0)*cnyTwd;
  const revenueTwd = Number(totals.revenue_twd || 0);
  return json({ month, totals: { ...totals, provider_cost_twd:Number(providerCostTwd.toFixed(2)), revenue_twd:Number(revenueTwd.toFixed(2)), gross_profit_twd:Number((revenueTwd-providerCostTwd).toFixed(2)), gross_margin_percent:revenueTwd>0?Number((((revenueTwd-providerCostTwd)/revenueTwd)*100).toFixed(2)):0 }, tenants:(tenants.results||[]).map((row)=>{const cost=Number(row.provider_cost_usd||0)*usdTwd+Number(row.provider_cost_cny||0)*cnyTwd;const revenue=Number(row.revenue_twd||0);return {...row,provider_cost_twd:Number(cost.toFixed(2)),gross_profit_twd:Number((revenue-cost).toFixed(2))};}) });
}

async function tenantUsage(env, tenantId, month) {
  const range=monthRange(month); if(!range) return json({error:"invalid_month",expected:"YYYY-MM"},400);
  const tenant=await env.DB.prepare(`SELECT id,name,status,billing_mode,currency,markup_percent FROM tenants WHERE id=?1 LIMIT 1`).bind(tenantId).first(); if(!tenant)return json({error:"tenant_not_found"},404);
  const byTask=await env.DB.prepare(`SELECT task,provider,provider_model,COUNT(*) AS requests,SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS successes,COALESCE(SUM(image_count),0) AS images,COALESCE(SUM(provider_cost_usd),0) AS provider_cost_usd,COALESCE(SUM(provider_cost_cny),0) AS provider_cost_cny,COALESCE(SUM(billable_amount_twd),0) AS billable_amount_twd FROM usage_events WHERE tenant_id=?1 AND created_at>=?2 AND created_at<?3 GROUP BY task,provider,provider_model ORDER BY billable_amount_twd DESC`).bind(tenantId,range.start,range.end).all();
  return json({tenant,month,usage:byTask.results||[]});
}

async function createTenant(env, request) {
  const body=await parseJson(request); if(!body?.name?.trim())return json({error:"tenant_name_required"},400);
  const id=`tenant_${crypto.randomUUID().replace(/-/g,"").slice(0,16)}`; const mode=["prepaid","postpaid","byok"].includes(body.billing_mode)?body.billing_mode:"postpaid"; const markup=Number.isFinite(Number(body.markup_percent))?Number(body.markup_percent):30;
  await env.DB.prepare(`INSERT INTO tenants (id,name,status,billing_mode,currency,markup_percent,created_at,updated_at) VALUES (?1,?2,'active',?3,'TWD',?4,datetime('now'),datetime('now'))`).bind(id,body.name.trim(),mode,markup).run();
  if(body.plan_id){const plan=await env.DB.prepare(`SELECT id FROM plans WHERE id=?1 AND status='active' LIMIT 1`).bind(body.plan_id).first();if(plan){await env.DB.prepare(`INSERT INTO tenant_subscriptions (id,tenant_id,plan_id,status,started_at) VALUES (?1,?2,?3,'active',datetime('now'))`).bind(`sub_${crypto.randomUUID()}`,id,body.plan_id).run();}}
  return json({tenant:{id,name:body.name.trim(),status:"active",billing_mode:mode,markup_percent:markup}},201);
}

async function setTenantStatus(env, tenantId, request) {
  const body=await parseJson(request); const status=body?.status; if(!["active","suspended","closed"].includes(status))return json({error:"invalid_status"},400);
  const r=await env.DB.prepare(`UPDATE tenants SET status=?2,updated_at=datetime('now') WHERE id=?1`).bind(tenantId,status).run(); if(!r.meta?.changes)return json({error:"tenant_not_found"},404); return json({tenant_id:tenantId,status});
}

async function createApiKey(env, tenantId, request) {
  const tenant=await env.DB.prepare(`SELECT id,status FROM tenants WHERE id=?1 LIMIT 1`).bind(tenantId).first(); if(!tenant)return json({error:"tenant_not_found"},404); if(tenant.status!=="active")return json({error:"tenant_not_active"},409);
  const body=await parseJson(request); const name=body?.name?.trim()||"default"; const raw=`agw_live_${randomToken(24)}`; const hash=await sha256Hex(raw); const id=`key_${crypto.randomUUID().replace(/-/g,"").slice(0,16)}`;
  await env.DB.prepare(`INSERT INTO api_keys (id,tenant_id,name,key_prefix,key_hash,status,created_at) VALUES (?1,?2,?3,?4,?5,'active',datetime('now'))`).bind(id,tenantId,name,raw.slice(0,16),hash).run();
  return json({api_key:raw,key:{id,tenant_id:tenantId,name,key_prefix:raw.slice(0,16),status:"active"},warning:"This API key is shown only once."},201);
}

async function listApiKeys(env, tenantId) {
  const rows=await env.DB.prepare(`SELECT id,name,key_prefix,status,last_used_at,created_at,revoked_at FROM api_keys WHERE tenant_id=?1 ORDER BY created_at DESC`).bind(tenantId).all(); return json({keys:rows.results||[]});
}

async function revokeApiKey(env, tenantId, keyId) {
  const r=await env.DB.prepare(`UPDATE api_keys SET status='revoked',revoked_at=datetime('now') WHERE id=?1 AND tenant_id=?2 AND status='active'`).bind(keyId,tenantId).run(); if(!r.meta?.changes)return json({error:"api_key_not_found_or_revoked"},404); return json({key_id:keyId,status:"revoked"});
}

async function createInvoice(env,tenantId,month){const range=monthRange(month);if(!range)return json({error:"invalid_month"},400);const usage=await env.DB.prepare(`SELECT COALESCE(SUM(billable_amount_twd),0) AS amount FROM usage_events WHERE tenant_id=?1 AND status='success' AND created_at>=?2 AND created_at<?3`).bind(tenantId,range.start,range.end).first();const sub=await env.DB.prepare(`SELECT p.monthly_fee_twd,p.included_credits_twd FROM tenant_subscriptions s JOIN plans p ON p.id=s.plan_id WHERE s.tenant_id=?1 AND s.status='active' LIMIT 1`).bind(tenantId).first();const usageAmount=Number(usage?.amount||0),monthlyFee=Number(sub?.monthly_fee_twd||0),credits=Math.min(usageAmount,Number(sub?.included_credits_twd||0)),subtotal=Math.max(0,monthlyFee+usageAmount-credits),tax=0,total=subtotal+tax,id=`inv_${month.replace('-', '')}_${tenantId}`;await env.DB.prepare(`INSERT OR REPLACE INTO invoices (id,tenant_id,period_start,period_end,usage_amount_twd,monthly_fee_twd,credits_twd,subtotal_twd,tax_twd,total_twd,status,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,'draft',datetime('now'))`).bind(id,tenantId,range.start,range.end,usageAmount,monthlyFee,credits,subtotal,tax,total).run();return json({invoice:{id,tenant_id:tenantId,month,usage_amount_twd:usageAmount,monthly_fee_twd:monthlyFee,credits_twd:credits,subtotal_twd:subtotal,tax_twd:tax,total_twd:total,status:"draft"}},201);}

export async function handleAdmin(request, env, url) {
  if (!(await adminAuthorized(request, env))) return json({ error:"admin_unauthorized" },401);
  const month=url.searchParams.get("month")||new Date().toISOString().slice(0,7);
  if(request.method==="GET"&&url.pathname==="/admin/dashboard")return dashboard(env,month);
  if(request.method==="POST"&&url.pathname==="/admin/tenants")return createTenant(env,request);
  const statusMatch=url.pathname.match(/^\/admin\/tenants\/([^/]+)\/status$/);if(request.method==="PATCH"&&statusMatch)return setTenantStatus(env,decodeURIComponent(statusMatch[1]),request);
  const usageMatch=url.pathname.match(/^\/admin\/tenants\/([^/]+)\/usage$/);if(request.method==="GET"&&usageMatch)return tenantUsage(env,decodeURIComponent(usageMatch[1]),month);
  const keysMatch=url.pathname.match(/^\/admin\/tenants\/([^/]+)\/keys$/);if(keysMatch&&request.method==="POST")return createApiKey(env,decodeURIComponent(keysMatch[1]),request);if(keysMatch&&request.method==="GET")return listApiKeys(env,decodeURIComponent(keysMatch[1]));
  const revokeMatch=url.pathname.match(/^\/admin\/tenants\/([^/]+)\/keys\/([^/]+)$/);if(request.method==="DELETE"&&revokeMatch)return revokeApiKey(env,decodeURIComponent(revokeMatch[1]),decodeURIComponent(revokeMatch[2]));
  const invoiceMatch=url.pathname.match(/^\/admin\/tenants\/([^/]+)\/invoices$/);if(request.method==="POST"&&invoiceMatch)return createInvoice(env,decodeURIComponent(invoiceMatch[1]),month);
  if(request.method==="GET"&&url.pathname==="/admin/invoices"){const rows=await env.DB.prepare(`SELECT i.*,t.name AS tenant_name FROM invoices i JOIN tenants t ON t.id=i.tenant_id ORDER BY period_start DESC,tenant_name`).all();return json({invoices:rows.results||[]});}
  return json({error:"admin_not_found"},404);
}
