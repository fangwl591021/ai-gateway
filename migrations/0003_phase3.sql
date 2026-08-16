PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  monthly_fee_twd REAL NOT NULL DEFAULT 0,
  included_credits_twd REAL NOT NULL DEFAULT 0,
  default_markup_percent REAL NOT NULL DEFAULT 30,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tenant_subscriptions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL UNIQUE,
  plan_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','cancelled')),
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (plan_id) REFERENCES plans(id)
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  usage_amount_twd REAL NOT NULL DEFAULT 0,
  monthly_fee_twd REAL NOT NULL DEFAULT 0,
  credits_twd REAL NOT NULL DEFAULT 0,
  subtotal_twd REAL NOT NULL DEFAULT 0,
  tax_twd REAL NOT NULL DEFAULT 0,
  total_twd REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued','paid','void')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  issued_at TEXT,
  paid_at TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  UNIQUE (tenant_id, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_invoices_tenant_period ON invoices(tenant_id, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status, created_at);

INSERT OR IGNORE INTO plans
(id, name, monthly_fee_twd, included_credits_twd, default_markup_percent)
VALUES
('plan_starter', 'Starter', 0, 0, 50),
('plan_pro', 'Pro', 990, 500, 35),
('plan_business', 'Business', 2990, 2000, 25);
