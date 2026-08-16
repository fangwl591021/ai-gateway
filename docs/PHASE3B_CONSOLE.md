# Phase 3B — Web Admin Console

部署完成後開啟：

`https://ai-gateway.fangwl591021.workers.dev/console`

## 功能

- 月度 Dashboard
- AI Provider 成本
- 客戶應收營收
- 毛利與毛利率
- Tenant 用量列表
- 建立 Tenant
- 建立 Tenant API Key（明文僅顯示一次）
- 建立月結 Invoice draft
- Invoice 清單

## 前置條件

先完成 Phase 3 migration：

```bash
npx wrangler d1 execute ai-gateway-db --remote --file=./migrations/0003_phase3.sql
```

設定 Admin Secret：

```bash
npx wrangler secret put ADMIN_API_KEY
```

再部署：

```bash
npx wrangler deploy
```

## Console 登入方式

目前 MVP 不使用帳號密碼資料表。Console 會要求 `ADMIN_API_KEY`，只存於瀏覽器 `sessionStorage`，並透過 `X-Admin-Key` Header 呼叫管理 API。

正式商用版建議下一步改為 Cloudflare Access / OAuth，讓管理者身分不依賴共享密鑰。

## 新客戶流程

1. `/console` → 新增客戶。
2. 選 billing mode、markup、可選方案。
3. 建立 API Key。
4. API Key 只顯示一次，交給該客戶的系統串接。
5. 客戶所有 `/v1/run` 用量自動歸戶。
6. 月底在 Console 按「月結」建立 Invoice draft。

## 安全設計

- Provider Secrets 不會出現在 Console。
- 客戶 API Key 在 D1 只保存 SHA-256 hash。
- 新 API Key 只回傳一次明文。
- Admin API 使用 timing-safe secret comparison。
- Console 設置 CSP 與 `frame-ancestors 'none'`。
- R2 圖片仍依 Tenant API Key 隔離。

## Phase 3C 建議

- Tenant 詳細頁：API Keys、Task Rate Cards、Plan、Usage 趨勢。
- API Key revoke UI。
- Tenant active/suspended 切換 UI。
- Wallet / prepaid ledger。
- 額度不足時 `/v1/run` 即時拒絕。
- Invoice issued/paid 狀態流程。
- CSV 匯出。
- Cloudflare Access / OAuth 管理登入。
