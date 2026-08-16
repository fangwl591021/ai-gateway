# AI Gateway

AI Gateway 是一個獨立的多租戶 AI SaaS 中介層，讓不同產品只需要串接一套 API，就能依地區、成本、任務與品質需求，自動路由到不同 AI 供應商。

## 產品目標

1. **單一入口**：所有內部與外部系統只呼叫 AI Gateway。
2. **多供應商**：支援 OpenAI、Google Gemini、Alibaba Qwen，後續可加入 Doubao、GLM、DeepSeek。
3. **跨區域**：台灣與國際流量可用 OpenAI/Gemini/Qwen；中國大陸流量可路由至 Qwen 等中國可用模型。
4. **多租戶計費**：每個客戶、每個系統都有獨立 Tenant、API Key、用量、成本與售價紀錄。
5. **能力導向路由**：上層不指定模型，只指定能力，例如文字分析、名片 OCR、DM 圖片理解、AI 試戴/髮型圖片編輯。
6. **可商業化**：未來可直接對外提供 API，按月費、點數或實際用量收費。

## 建議技術架構

- Runtime: Cloudflare Workers
- API: REST / JSON
- Auth: Gateway API Key + Tenant ID
- Database: Cloudflare D1
- Cache / rate-limit: Cloudflare KV
- Object storage: Cloudflare R2（需要保留圖片時）
- Async jobs: Cloudflare Queues（大量圖片或批次任務）
- Observability: Workers Analytics + 自建 usage_logs
- Secrets: Cloudflare Worker Secrets

## 核心架構

```text
Client Systems
  ├─ 名片系統
  ├─ DM 分析
  ├─ AI 眼鏡試戴
  ├─ AI 髮型
  └─ 外部客戶系統
        │
        ▼
    AI Gateway
        │
        ├─ Authentication / Tenant
        ├─ Usage Metering
        ├─ Billing Rules
        ├─ Region Router
        ├─ Capability Router
        ├─ Provider Adapter
        └─ Audit / Error Logs
             │
             ├─ OpenAI
             ├─ Gemini
             ├─ Qwen
             ├─ Doubao
             ├─ GLM
             └─ DeepSeek
```

## 第一版能力代碼

| capability | 用途 |
|---|---|
| `text.analyze` | 摘要、分類、標籤、CRM 分析 |
| `vision.business_card` | 名片辨識與欄位結構化 |
| `vision.dm` | DM / 海報圖片理解與欄位擷取 |
| `image.tryon.glasses` | 眼鏡 AI 試戴 |
| `image.hairstyle` | AI 髮型 |
| `image.generate` | 一般圖片生成 |

## 路由策略 v1

### 台灣 / 國際

- `text.analyze`: Qwen low-cost → Gemini/OpenAI fallback
- `vision.business_card`: Qwen OCR / Qwen VL → Gemini/OpenAI fallback
- `vision.dm`: Qwen VL → Gemini/OpenAI fallback
- `image.tryon.glasses`: OpenAI high-quality → Qwen equivalent fallback
- `image.hairstyle`: OpenAI high-quality → Qwen equivalent fallback

### 中國大陸

- `text.analyze`: Qwen → DeepSeek/GLM fallback
- `vision.business_card`: Qwen OCR / Qwen VL
- `vision.dm`: Qwen VL
- `image.tryon.glasses`: Qwen high-quality image model
- `image.hairstyle`: Qwen high-quality image model

> Provider 與 Model 不寫死在客戶端。所有路由規則由 Gateway 後台設定。

## API 草案

### POST `/v1/run`

```json
{
  "capability": "vision.business_card",
  "region": "TW",
  "input": {
    "image_url": "https://..."
  },
  "metadata": {
    "customer_ref": "card-123",
    "app": "business-card"
  }
}
```

Response:

```json
{
  "request_id": "req_xxx",
  "status": "success",
  "provider": "qwen",
  "model": "...",
  "result": {},
  "usage": {
    "input_tokens": 0,
    "output_tokens": 0,
    "images": 1,
    "provider_cost": 0,
    "billable_amount": 0,
    "currency": "TWD"
  }
}
```

## 多租戶資料模型 v1

### tenants
- id
- name
- status
- plan_id
- billing_currency
- created_at

### api_keys
- id
- tenant_id
- key_hash
- name
- status
- allowed_capabilities
- rate_limit
- created_at
- last_used_at

### plans
- id
- name
- monthly_fee
- included_credits
- markup_percent
- status

### provider_models
- id
- provider
- model
- capability
- region
- input_unit_cost
- output_unit_cost
- image_unit_cost
- currency
- priority
- enabled

### routing_rules
- id
- capability
- region
- primary_model_id
- fallback_model_id
- max_cost
- enabled

### usage_logs
- id
- request_id
- tenant_id
- api_key_id
- capability
- provider
- model
- region
- input_tokens
- output_tokens
- image_count
- provider_cost
- billable_amount
- currency
- latency_ms
- status
- created_at

### invoices
- id
- tenant_id
- period
- subtotal
- tax
- total
- currency
- status
- created_at

## 計費原則

Gateway 必須同時記錄兩個數字：

1. **Provider Cost**：實際付給 OpenAI / Gemini / Qwen 的成本。
2. **Billable Amount**：向客戶收取的金額。

兩者不可混在一起，才能計算每個 Tenant、產品與 Capability 的毛利。

建議初期支援三種收費模式：

- 月租 + 內含額度
- 預付點數
- 依實際用量 + markup

## 安全原則

- Provider API Key 只能存在 Worker Secrets，不進 GitHub、不回傳客戶端。
- Gateway API Key 只保存 hash。
- 每次呼叫都必須綁定 Tenant。
- 圖片預設不永久保存；若需要保存才進 R2。
- usage log 不存敏感圖片內容，只存必要 metadata。
- 每個 Tenant 可限制 capability、每日額度與 rate limit。

## 開發階段

### Phase 1 — Gateway Core
- Worker 專案骨架
- `/health`
- `/v1/run`
- Tenant / API Key 驗證
- usage_logs
- Provider Adapter interface
- Qwen + OpenAI 第一版 Adapter

### Phase 2 — Routing & Metering
- 地區路由
- capability 路由
- fallback
- provider cost 計算
- billable amount 計算
- rate limit / quota

### Phase 3 — Admin & Billing
- Tenant 管理
- API Key 管理
- 用量儀表板
- 方案與售價
- 月結報表 / invoice data

### Phase 4 — China-ready
- Qwen image / vision 實測
- 中國節點與網路可達性驗證
- 中國版 provider routing policy
- 台灣與中國同功能 A/B 品質測試

## 第一個 MVP 驗收條件

一個外部系統只拿到一組 Gateway API Key，即可：

1. 呼叫 `text.analyze`。
2. 呼叫 `vision.business_card`。
3. Gateway 自動選模型。
4. 每次請求都有 request_id。
5. 完整記錄 provider cost 與 billable amount。
6. 管理者可查某 Tenant 當月用了多少次、成本多少、應收多少。
7. 更換底層模型時，客戶端完全不用改程式。
