# Phase 2 Setup

Phase 2 turns `/v1/run` from a routing placeholder into a real provider execution path with fallback, provider-cost metering, and tenant billing.

## Completed

- Qwen text adapter via OpenAI-compatible Chat Completions
- Qwen vision adapter for business cards / DM analysis
- Qwen image editing adapter using `qwen-image-2.0-pro`
- Qwen image fallback to `qwen-image-2.0`
- China / global provider routing
- OpenAI text + vision adapter
- Provider fallback executor
- Region-aware provider pricing
- Provider cost -> TWD conversion
- Tenant billing: markup / fixed / pass-through
- Usage event completion status, model, usage, cost, billable amount, latency and error code

## Important current limitation

`gpt-image-2` is registered as the preferred global image-edit route, but binary image-input handling for the OpenAI Images Edit endpoint is intentionally not enabled yet. If a global eye-glasses / hairstyle request hits this route today, it will fall back to Qwen. This avoids silently implementing an unsafe or incompatible remote-image downloader in the Worker.

China image editing is fully wired to Qwen.

## 1. Configure Alibaba Cloud Model Studio

China (Beijing) and international (Singapore) Model Studio credentials are separate. Configure the region you actually use.

### China

```bash
npx wrangler secret put QWEN_CN_API_KEY
npx wrangler secret put QWEN_CN_WORKSPACE_ID
```

### International Qwen fallback (optional)

```bash
npx wrangler secret put QWEN_INTL_API_KEY
npx wrangler secret put QWEN_INTL_WORKSPACE_ID
```

### OpenAI text / vision fallback (optional)

```bash
npx wrangler secret put OPENAI_API_KEY
```

Do not commit provider API keys to GitHub.

## 2. Database

### If the D1 database has NOT been initialized yet

Use the current full schema, then load prices:

```bash
npx wrangler d1 execute ai-gateway-db --remote --file=./schema.sql
npx wrangler d1 execute ai-gateway-db --remote --file=./seeds/provider_prices.sql
```

### If Phase 1 schema was already applied

Run the Phase 2 migration:

```bash
npx wrangler d1 execute ai-gateway-db --remote --file=./migrations/0002_phase2.sql
```

Do not run `0002_phase2.sql` on a fresh DB after the new schema, because the `region` column already exists.

## 3. FX rates

The Worker defaults to:

- CNY/TWD = 4.75
- USD/TWD = 30.0

For production billing, set current values as Worker vars and update them when needed:

```jsonc
"vars": {
  "ENVIRONMENT": "production",
  "CNY_TWD_RATE": "4.75",
  "USD_TWD_RATE": "30.0"
}
```

## 4. Deploy

```bash
npm install
npx wrangler check
npx wrangler deploy
```

## 5. Health check

```bash
curl https://ai-gateway.fangwl591021.workers.dev/health
```

Expected Phase 2 fields include:

```json
{
  "version": "0.2.0",
  "qwen_cn_configured": true
}
```

## 6. Test China eye-glasses try-on

Qwen accepts 1-3 image references. For try-on, the first image should be the person's base image and the second the glasses reference.

```bash
curl -X POST https://ai-gateway.fangwl591021.workers.dev/v1/run \
  -H "Authorization: Bearer agw_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "task": "image.tryon.glasses",
    "region": "cn",
    "input": {
      "image_url": "https://example.com/person.jpg",
      "product_image_url": "https://example.com/glasses.png",
      "size": "1536*1536"
    },
    "metadata": {
      "app": "glasses-tryon",
      "customer_ref": "demo-001"
    }
  }'
```

The response returns a Qwen-generated PNG URL. Alibaba Cloud states generated image URLs are temporary, so production should copy successful output images to your own R2 bucket before returning a durable URL to end users.

## 7. Test hairstyle

```bash
curl -X POST https://ai-gateway.fangwl591021.workers.dev/v1/run \
  -H "Authorization: Bearer agw_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "task": "image.hairstyle",
    "region": "cn",
    "input": {
      "image_url": "https://example.com/person.jpg",
      "reference_image_url": "https://example.com/hair-reference.jpg"
    }
  }'
```

## 8. Test business card

```bash
curl -X POST https://ai-gateway.fangwl591021.workers.dev/v1/run \
  -H "Authorization: Bearer agw_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "task": "vision.business_card",
    "region": "cn",
    "input": {
      "image_url": "https://example.com/card.jpg"
    }
  }'
```

## Billing output

Every successful response now includes:

```json
{
  "usage": {
    "input_units": 0,
    "output_units": 0,
    "image_count": 1,
    "provider_cost": 0.5,
    "provider_currency": "CNY",
    "provider_cost_twd": 2.375,
    "billable_amount_twd": 3.0875,
    "priced": true
  }
}
```

The sample billable amount above assumes the tenant default markup is 30%.

## Next Phase 2B

1. Add safe binary/image input contract for OpenAI `gpt-image-2` editing.
2. Persist generated Qwen images to R2 so Alibaba's temporary output URLs are never exposed as durable assets.
3. Add Gemini adapter.
4. Add per-tenant quota and rate limiting.
5. Add admin usage/report endpoints.
