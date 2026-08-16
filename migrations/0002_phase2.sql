-- Apply this migration only to a database that was initialized with the Phase 1 schema.
ALTER TABLE provider_prices ADD COLUMN region TEXT NOT NULL DEFAULT 'global';

DROP INDEX IF EXISTS idx_provider_prices_lookup;
CREATE INDEX IF NOT EXISTS idx_provider_prices_lookup
  ON provider_prices(provider, model, region, effective_from);

-- Alibaba Cloud Model Studio, China (Beijing), public list prices checked 2026-08-16.
INSERT OR REPLACE INTO provider_prices
(id, provider, model, region, unit_type, input_price, output_price, image_price, currency, effective_from)
VALUES
('qwen-cn-image-2-pro-20260816', 'qwen', 'qwen-image-2.0-pro', 'cn', 'image', 0, 0, 0.5, 'CNY', '2026-08-16 00:00:00'),
('qwen-cn-image-2-20260816', 'qwen', 'qwen-image-2.0', 'cn', 'image', 0, 0, 0.2, 'CNY', '2026-08-16 00:00:00'),
('qwen-cn-vl-flash-20260816', 'qwen', 'qwen3-vl-flash', 'cn', 'tokens_per_million', 0.15, 1.5, 0, 'CNY', '2026-08-16 00:00:00'),
('qwen-cn-plus-20260816', 'qwen', 'qwen-plus', 'cn', 'tokens_per_million', 0.8, 2.0, 0, 'CNY', '2026-08-16 00:00:00');
