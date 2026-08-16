PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','closed')),
  billing_mode TEXT NOT NULL DEFAULT 'prepaid' CHECK (billing_mode IN ('prepaid','postpaid','byok')),
  currency TEXT NOT NULL DEFAULT 'TWD',
  markup_percent REAL NOT NULL DEFAULT 30,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX IF NOT EXISTS idx_api_keys_tenant_id ON api_keys(tenant_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_status ON api_keys(status);

CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  api_key_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  task TEXT NOT NULL,
  region TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_model TEXT,
  status TEXT NOT NULL,
  input_units INTEGER NOT NULL DEFAULT 0,
  output_units INTEGER NOT NULL DEFAULT 0,
  image_count INTEGER NOT NULL DEFAULT 0,
  provider_cost_usd REAL NOT NULL DEFAULT 0,
  provider_cost_cny REAL NOT NULL DEFAULT 0,
  billable_amount_twd REAL NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  error_code TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (api_key_id) REFERENCES api_keys(id)
);

CREATE INDEX IF NOT EXISTS idx_usage_tenant_created ON usage_events(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_request_id ON usage_events(request_id);
CREATE INDEX IF NOT EXISTS idx_usage_provider ON usage_events(provider, created_at);

CREATE TABLE IF NOT EXISTS provider_prices (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  region TEXT NOT NULL DEFAULT 'global',
  unit_type TEXT NOT NULL,
  input_price REAL NOT NULL DEFAULT 0,
  output_price REAL NOT NULL DEFAULT 0,
  image_price REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_provider_prices_lookup
  ON provider_prices(provider, model, region, effective_from);

CREATE TABLE IF NOT EXISTS tenant_rate_cards (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  task TEXT NOT NULL,
  billing_type TEXT NOT NULL DEFAULT 'markup' CHECK (billing_type IN ('markup','fixed','pass_through')),
  markup_percent REAL,
  fixed_price_twd REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_rate_card_unique
  ON tenant_rate_cards(tenant_id, task);
