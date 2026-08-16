# Phase 1 Setup

## 目前已完成

- Cloudflare Worker 專案骨架
- `GET /health`
- `POST /v1/run`
- Tenant / API Key 驗證
- D1 Schema
- Usage event 紀錄
- Region router：`cn` / `global`
- Capability router：文字、Vision、眼鏡試戴、髮型
- Provider route placeholder：OpenAI / Gemini / Qwen

## 1. 建立 D1

```bash
npx wrangler d1 create ai-gateway-db
```

把回傳的 `database_id` 加進 `wrangler.jsonc`：

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "ai-gateway-db",
    "database_id": "<YOUR_DATABASE_ID>"
  }
]
```

## 2. 建表

```bash
npx wrangler d1 execute ai-gateway-db --remote --file=./schema.sql
```

## 3. 建立第一個 Tenant / API Key

```bash
node scripts/generate-api-key.mjs live "First Customer"
```

程式會輸出：

- Tenant ID
- 一次性顯示的 Gateway API Key
- 要寫入 D1 的兩行 SQL

請保存 Gateway API Key。D1 只儲存 SHA-256 hash，不儲存明文。

## 4. 部署

```bash
npm install
npx wrangler check
npx wrangler deploy
```

## 5. 健康檢查

```bash
curl https://ai-gateway.fangwl591021.workers.dev/health
```

預期：

```json
{
  "ok": true,
  "service": "ai-gateway",
  "version": "0.1.0",
  "d1_configured": true
}
```

## 6. 第一個 API 呼叫

```bash
curl -X POST https://ai-gateway.fangwl591021.workers.dev/v1/run \
  -H "Authorization: Bearer agw_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "task": "image.tryon.glasses",
    "region": "cn",
    "input": {
      "image_url": "https://example.com/person.jpg",
      "product_image_url": "https://example.com/glasses.png"
    },
    "metadata": {
      "app": "glasses-tryon",
      "customer_ref": "demo-001"
    }
  }'
```

Phase 1 目前只會完成認證、路由與用量紀錄，尚不會真正呼叫 AI Provider。Provider Adapter 會在 Phase 2 接上。

## Region 規則

- `region: "cn"`：強制中國路由
- `region: "global"`：強制國際路由
- 不傳：Gateway 依 Cloudflare `request.cf.country` 判斷；CN → `cn`，其他 → `global`

## Phase 2 順序

1. Qwen Adapter
2. OpenAI Adapter
3. Provider cost metering
4. Billable amount 計算
5. Fallback / retry
6. Gemini Adapter
7. 管理 API
