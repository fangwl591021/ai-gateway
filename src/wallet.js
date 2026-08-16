export async function ensureWallet(env, tenantId) {
  await env.DB.prepare(`INSERT OR IGNORE INTO wallets (tenant_id,balance_twd,status,updated_at) VALUES (?1,0,'active',datetime('now'))`).bind(tenantId).run();
  return env.DB.prepare(`SELECT tenant_id,balance_twd,status,updated_at FROM wallets WHERE tenant_id=?1 LIMIT 1`).bind(tenantId).first();
}

export async function getWallet(env, tenantId) {
  return ensureWallet(env, tenantId);
}

export async function topupWallet(env, { tenantId, amountTwd, note = null, referenceId = null }) {
  const amount = Number(amountTwd);
  if (!Number.isFinite(amount) || amount <= 0) throw Object.assign(new Error('invalid_topup_amount'), { code: 'invalid_topup_amount' });
  await ensureWallet(env, tenantId);
  const result = await env.DB.prepare(`UPDATE wallets SET balance_twd=balance_twd+?2,updated_at=datetime('now') WHERE tenant_id=?1 AND status='active' RETURNING balance_twd`).bind(tenantId, amount).first();
  if (!result) throw Object.assign(new Error('wallet_not_active'), { code: 'wallet_not_active' });
  const id = `wlt_${crypto.randomUUID()}`;
  await env.DB.prepare(`INSERT INTO wallet_ledger (id,tenant_id,entry_type,amount_twd,balance_after_twd,reference_type,reference_id,note,created_at) VALUES (?1,?2,'topup',?3,?4,'manual_topup',?5,?6,datetime('now'))`).bind(id, tenantId, amount, Number(result.balance_twd), referenceId, note).run();
  return { balance_twd: Number(result.balance_twd), ledger_id: id };
}

export async function chargeWallet(env, { tenantId, amountTwd, requestId, note = null }) {
  const amount = Number(amountTwd);
  if (!Number.isFinite(amount) || amount < 0) throw Object.assign(new Error('invalid_charge_amount'), { code: 'invalid_charge_amount' });
  await ensureWallet(env, tenantId);
  if (amount === 0) return { charged: 0, balance_twd: Number((await getWallet(env, tenantId)).balance_twd || 0) };
  const result = await env.DB.prepare(`UPDATE wallets SET balance_twd=balance_twd-?2,updated_at=datetime('now') WHERE tenant_id=?1 AND status='active' AND balance_twd>=?2 RETURNING balance_twd`).bind(tenantId, amount).first();
  if (!result) {
    const wallet = await getWallet(env, tenantId);
    const error = new Error('insufficient_wallet_balance');
    error.code = 'insufficient_wallet_balance';
    error.balance_twd = Number(wallet?.balance_twd || 0);
    error.required_twd = amount;
    throw error;
  }
  const id = `wlc_${crypto.randomUUID()}`;
  await env.DB.prepare(`INSERT INTO wallet_ledger (id,tenant_id,entry_type,amount_twd,balance_after_twd,reference_type,reference_id,note,created_at) VALUES (?1,?2,'charge',?3,?4,'usage_request',?5,?6,datetime('now'))`).bind(id, tenantId, -amount, Number(result.balance_twd), requestId, note).run();
  return { charged: amount, balance_twd: Number(result.balance_twd), ledger_id: id };
}

export async function listWalletLedger(env, tenantId, limit = 100) {
  const n = Math.max(1, Math.min(200, Number(limit) || 100));
  const rows = await env.DB.prepare(`SELECT id,entry_type,amount_twd,balance_after_twd,reference_type,reference_id,note,created_at FROM wallet_ledger WHERE tenant_id=?1 ORDER BY created_at DESC LIMIT ?2`).bind(tenantId, n).all();
  return rows.results || [];
}
