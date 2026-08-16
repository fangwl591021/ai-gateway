# Phase 2B — Image Gateway

## 已完成

- OpenAI `gpt-image-2` image edit adapter
- Qwen image edit 與 OpenAI image edit 統一輸出格式
- 遠端圖片 HTTPS 驗證
- 基礎 SSRF 防護：拒絕 localhost / private IPv4 host
- 圖片 MIME type 驗證
- 單張圖片最大 20 MB
- R2 `ASSETS` binding
- AI 生成結果存入 R2
- `GET /v1/assets/:key`：使用 Gateway API Key 驗證 Tenant 後讀圖
- `/health` 顯示 R2 / OpenAI / Qwen 設定狀態

## 1. 建立 R2 bucket

```bash
npx wrangler r2 bucket create ai-gateway-assets
```

`wrangler.jsonc` 已設定：

```jsonc
"r2_buckets": [
  {
    "binding": "ASSETS",
    "bucket_name": "ai-gateway-assets"
  }
]
```

## 2. 設 OpenAI secret

```bash
npx wrangler secret put OPENAI_API_KEY
```

不要把 OpenAI Key 寫進 GitHub 或 `wrangler.jsonc`。

## 3. Qwen Secrets

中國北京區：

```bash
npx wrangler secret put QWEN_CN_API_KEY
npx wrangler secret put QWEN_CN_WORKSPACE_ID
```

如果要使用國際區 Qwen：

```bash
npx wrangler secret put QWEN_INTL_API_KEY
npx wrangler secret put QWEN_INTL_WORKSPACE_ID
```

北京與國際區 API Key / Workspace 請分開管理。

## 4. 部署前檢查

```bash
npm install
npx wrangler check
npx wrangler deploy --dry-run
npx wrangler deploy
```

## 5. Health Check

```bash
curl https://ai-gateway.fangwl591021.workers.dev/health
```

至少確認：

```json
{
  "version": "0.2.1",
  "d1_configured": true,
  "r2_configured": true,
  "openai_configured": true,
  "qwen_cn_configured": true
}
```

## 6. 台灣 / Global：OpenAI 眼鏡試戴

```bash
curl -X POST https://ai-gateway.fangwl591021.workers.dev/v1/run \
  -H "Authorization: Bearer agw_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "task": "image.tryon.glasses",
    "region": "global",
    "input": {
      "image_url": "https://example.com/person.jpg",
      "product_image_url": "https://example.com/glasses.png",
      "quality": "high",
      "input_fidelity": "high",
      "size": "1024x1024"
    },
    "metadata": {
      "app": "glasses-tryon",
      "customer_ref": "test-global-001"
    }
  }'
```

路由：

1. `gpt-image-2`
2. Qwen fallback

## 7. 中國：Qwen 眼鏡試戴

同一支 API，只改：

```json
"region": "cn"
```

路由：

1. `qwen-image-2.0-pro`
2. `qwen-image-2.0`

## 8. 統一圖片輸出

如果 R2 正常，成功結果會類似：

```json
{
  "result": {
    "storage": "r2",
    "images": [
      {
        "asset_key": "generated/tenant_xxx/request_xxx/openai-1.png",
        "content_type": "image/png",
        "size": 1234567,
        "download_url": "https://ai-gateway.fangwl591021.workers.dev/v1/assets/generated%2Ftenant_xxx%2Frequest_xxx%2Fopenai-1.png"
      }
    ]
  }
}
```

下載圖片時仍需相同 Tenant 的 Gateway API Key：

```bash
curl \
  -H "Authorization: Bearer agw_live_xxx" \
  "<download_url>" \
  --output result.png
```

其他 Tenant 無法讀取該物件。

## 9. 安全限制

目前 Gateway 對遠端圖片：

- 只允許 HTTPS
- 拒絕 localhost / 常見 private IPv4 host
- 不自動跟隨 redirect
- 只允許 JPEG / PNG / WebP
- 最大 20 MB

正式對外商用前，建議 Phase 2C 再增加：

- DNS resolution 後 private IP 驗證
- 每 Tenant 圖片上傳配額
- R2 lifecycle 自動刪除，例如 24 小時或 7 天
- Browser 直傳 R2 的 signed upload 流程
- 圖片病毒 / payload 檢查

## 10. 成本注意事項

`provider_prices` 必須有對應模型價格，Gateway 才會把 `priced` 設為 true。

Qwen China 價格已放在 `seeds/provider_prices.sql`。

GPT Image 2 的實際費用會受品質、尺寸與圖片輸入使用量影響；不要用單一固定 image price 猜完整帳單。Phase 2C 建議把圖片計費規則升級成 `model + quality + size + input image usage` 的 rate-card schema，再依官方帳務規則更新。
