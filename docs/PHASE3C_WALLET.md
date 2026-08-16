# Phase 3C — Prepaid Wallet

## 已完成

- `wallets` 餘額表
- `wallet_ledger` 不可變動的儲值/扣款流水
- 預付 Tenant 在 AI 呼叫前檢查最低餘額
- AI 成功後依 `billable_amount_twd` 精準扣款
- 餘額不足回 `402`
- 管理 API：查 Wallet、查流水、人工儲值
- `/console` 增加 Wallet 按鈕與儲值介面

## 套用 migration

```bash
npx wrangler d1 execute ai-gateway-db --remote --file=./migrations/0004_wallet.sql
```

## 可選設定

在 Worker vars 設定最低可用餘額，例如：

```jsonc
"PREPAID_MIN_BALANCE_TWD": "10"
```

未設定時預設為 NT$1。

## 查詢 Wallet

```bash
curl "https://ai-gateway.fangwl591021.workers.dev/admin/tenants/TENANT_ID/wallet" \
  -H "X-Admin-Key: YOUR_ADMIN_API_KEY"
```

## 儲值

```bash
curl -X POST "https://ai-gateway.fangwl591021.workers.dev/admin/tenants/TENANT_ID/wallet/topup" \
  -H "X-Admin-Key: YOUR_ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"amount_twd":3000,"note":"manual bank transfer"}'
```

## 預付扣款流程

1. Gateway 驗證 Tenant / API Key。
2. 若 `billing_mode=prepaid`，檢查 Wallet 狀態與最低餘額。
3. 呼叫 AI Provider。
4. 計算 Provider Cost。
5. 套 Rate Card 得到 `billable_amount_twd`。
6. 從 Wallet 精準扣除應收金額。
7. 寫入 `wallet_ledger` 與 `usage_events`。
8. Response 回傳 `wallet.charged_twd` 與 `wallet.balance_twd`。

## 目前 MVP 邊界

高併發的同一 Tenant 仍可能在多個請求同時通過前置餘額檢查。D1 的條件式扣款可避免餘額變負數，但若最後精準扣款失敗，AI Provider 成本已經產生。正式大量商用前建議升級成「預授權/保留額度 → AI 呼叫 → 精準結算 → 釋放差額」模型。

## 下一階段

- 預授權 Wallet Reserve
- Refund / adjustment 管理 UI
- 自動儲值通知
- 低餘額通知
- 金流串接後自動入帳
- Tenant 自助入口查餘額與流水
