# Phase 3 — Admin & Billing

Phase 3 把 AI Gateway 從 Provider Router 升級成可管理、可計費的 SaaS 核心。

## 已完成

- 管理者 API Key 保護
- 月度 Dashboard
- Tenant 月度用量明細
- Provider / Model / Task 用量彙總
- 毛利計算
- Plans / Subscriptions schema
- Invoice draft 產生
- Invoice 清單

## 1. 套用 migration

```bash
npx wrangler d1 execute ai-gateway-db --remote --file=./migrations/0003_phase3.sql
```

## 2. 設定管理者 Secret

```bash
npx wrangler secret put ADMIN_API_KEY
```

請使用高熵隨機字串，不要放進 GitHub。

## 3. Dashboard

```bash
curl "https://ai-gateway.fangwl591021.workers.dev/admin/dashboard?month=2026-08" \
  -H "X-Admin-Key: YOUR_ADMIN_API_KEY"
```

回傳包含：requests、successes、failures、圖片數、Provider 成本、營收、毛利、毛利率，以及每個 Tenant 的彙總。

## 4. Tenant 用量

```bash
curl "https://ai-gateway.fangwl591021.workers.dev/admin/tenants/TENANT_ID/usage?month=2026-08" \
  -H "X-Admin-Key: YOUR_ADMIN_API_KEY"
```

## 5. 建立月結草稿

```bash
curl -X POST "https://ai-gateway.fangwl591021.workers.dev/admin/tenants/TENANT_ID/invoices?month=2026-08" \
  -H "X-Admin-Key: YOUR_ADMIN_API_KEY"
```

Invoice 計算：

`月費 + 成功用量應收 - 內含額度 = subtotal`

目前 `tax_twd=0`，稅務/發票串接留待正式商業規則確認後加入，不在程式內假設台灣或中國稅制。

## 6. Invoice 清單

```bash
curl "https://ai-gateway.fangwl591021.workers.dev/admin/invoices" \
  -H "X-Admin-Key: YOUR_ADMIN_API_KEY"
```

## 預設方案（可直接改 DB）

| Plan | 月費 | 內含 AI 額度 | 預設 markup |
|---|---:|---:|---:|
| Starter | NT$0 | NT$0 | 50% |
| Pro | NT$990 | NT$500 | 35% |
| Business | NT$2,990 | NT$2,000 | 25% |

這些只是 MVP 初始值，不代表最終商業定價。

## Phase 3B 建議

1. Web 管理後台 UI
2. Tenant 建立 / 停權 API
3. API Key 建立 / revoke API
4. Plan / Rate Card 編輯 UI
5. 預付點數 Wallet / Ledger
6. 額度不足即時阻擋
7. Invoice issued / paid workflow
8. 匯出 CSV / 月結報表
9. Dashboard 日期與 App 維度篩選
10. Admin 身分驗證升級（Cloudflare Access / OAuth）
