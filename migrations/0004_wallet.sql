PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS wallets (
  tenant_id TEXT PRIMARY KEY,
  balance_twd REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
CREATE TABLE IF NOT EXISTS wallet_ledger (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  entry_type TEXT NOT NULL,
  amount_twd REAL NOT NULL,
  balance_after_twd REAL NOT NULL,
  reference_type TEXT,
  reference_id TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
CREATE INDEX IF NOT EXISTS idx_wallet_ledger_tenant_created ON wallet_ledger(tenant_id, created_at DESC);
