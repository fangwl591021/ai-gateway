# Phase 3B — Web Console & Commercial Controls

## 已完成

- `/console` Web 管理後台
- Tenant 建立 / 停權 / 啟用
- Tenant API Key 建立 / 列表 / revoke
- 月度 Dashboard：呼叫量、圖片量、AI 成本、應收、毛利、毛利率
- 月結 Invoice 草稿
- Plan 清單
- 既有 Tenant 切換 Plan
- Tenant Task Rate Card：markup / fixed / pass-through

## 部署前

先完成 Phase 3 migration：

```bash
npx wrangler d1 execute ai-gateway-db --remote --file=./migrations/0003_phase3.sql
```

設定管理者金鑰：

```bash
npx wrangler secret put ADMIN_API_KEY
```

部署：

```bash
npx wrangler deploy
```

## 管理後台

部署後開啟：

```text
https://ai-gateway.fangwl591021.workers.dev/console
```

輸入 `ADMIN_API_KEY`。管理金鑰只存於瀏覽器 `sessionStorage`，不寫入 GitHub。

## Plan API

```bash
curl "https://ai-gateway.fangwl591021.workers.dev/admin/plans" \
  -H "X-Admin-Key: YOUR_ADMIN_API_KEY"
```

## 替既有客戶切換方案

```bash
curl -X PUT "https://ai-gateway.fangwl591021.workers.dev/admin/tenants/TENANT_ID/subscription" \
  -H "X-Admin-Key: YOUR_ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "plan_id": "plan_business",
    "apply_default_markup": true
  }'
```

## Rate Card

取得：

```bash
curl "https://ai-gateway.fangwl591021.workers.dev/admin/tenants/TENANT_ID/rate-cards" \
  -H "X-Admin-Key: YOUR_ADMIN_API_KEY"
```

### 依成本加價

```bash
curl -X PUT "https://ai-gateway.fangwl591021.workers.dev/admin/tenants/TENANT_ID/rate-cards" \
  -H "X-Admin-Key: YOUR_ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "task": "vision.business_card",
    "billing_type": "markup",
    "markup_percent": 50
  }'
```

### 每次固定收費

```bash
curl -X PUT "https://ai-gateway.fangwl591021.workers.dev/admin/tenants/TENANT_ID/rate-cards" \
  -H "X-Admin-Key: YOUR_ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "task": "image.tryon.glasses",
    "billing_type": "fixed",
    "fixed_price_twd": 6
  }'
```

### 原價轉嫁

```json
{
  "task": "text.analyze",
  "billing_type": "pass_through"
}
```

## 商業化建議

AI Gateway 對客戶不應暴露 OpenAI、Qwen 或 Gemini 的原始價格。客戶只看到你的服務方案與計價單位；Gateway 內部保留 Provider Cost 與 Billable Amount，才能持續調整模型路由而不影響客戶端。

下一階段：

1. Console 加入 Plan / Rate Card 視覺化編輯器
2. Wallet / 點數 Ledger
3. 額度不足阻擋
4. 每日 / 每月 Quota
5. Invoice issued / paid 狀態操作
6. CSV 月結匯出
7. Cloudflare Access 管理者登入
