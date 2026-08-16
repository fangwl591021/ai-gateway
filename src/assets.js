const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function isPrivateHostname(hostname) {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return true;
  if (h === "127.0.0.1" || h === "0.0.0.0" || h === "::1") return true;
  if (/^10\./.test(h) || /^192\.168\./.test(h)) return true;
  const m = h.match(/^172\.(\d+)\./);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  if (/^169\.254\./.test(h)) return true;
  return false;
}

export function validateRemoteImageUrl(value) {
  let url;
  try { url = new URL(value); }
  catch { throw Object.assign(new Error("invalid_image_url"), { code: "invalid_image_url" }); }
  if (url.protocol !== "https:") throw Object.assign(new Error("image_url_must_use_https"), { code: "invalid_image_url" });
  if (isPrivateHostname(url.hostname)) throw Object.assign(new Error("private_image_host_not_allowed"), { code: "invalid_image_url" });
  return url;
}

async function readBoundedBody(response, maxBytes = MAX_IMAGE_BYTES) {
  const length = Number(response.headers.get("content-length") || 0);
  if (length && length > maxBytes) throw Object.assign(new Error("image_too_large"), { code: "image_too_large" });
  if (!response.body) throw Object.assign(new Error("image_body_missing"), { code: "image_fetch_failed" });

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw Object.assign(new Error("image_too_large"), { code: "image_too_large" });
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
  return out;
}

export async function fetchRemoteImage(value) {
  const url = validateRemoteImageUrl(value);
  const response = await fetch(url, { redirect: "error" });
  if (!response.ok) throw Object.assign(new Error(`image_fetch_http_${response.status}`), { code: "image_fetch_failed" });
  const contentType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.has(contentType)) throw Object.assign(new Error("unsupported_image_type"), { code: "unsupported_image_type" });
  const bytes = await readBoundedBody(response);
  return { bytes, contentType };
}

function extensionFor(contentType) {
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "image/webp") return "webp";
  return "png";
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function storeGeneratedImages(env, { tenantId, requestId, provider, images }) {
  if (!env.ASSETS || !Array.isArray(images) || !images.length) return null;
  const stored = [];

  for (let i = 0; i < images.length; i += 1) {
    const image = images[i];
    let bytes;
    let contentType = "image/png";
    if (typeof image === "string" && image.startsWith("https://")) {
      ({ bytes, contentType } = await fetchRemoteImage(image));
    } else if (typeof image === "string") {
      bytes = base64ToBytes(image.replace(/^data:image\/\w+;base64,/, ""));
    } else if (image?.b64_json) {
      bytes = base64ToBytes(image.b64_json);
    } else if (image?.url) {
      ({ bytes, contentType } = await fetchRemoteImage(image.url));
    } else {
      continue;
    }

    if (bytes.byteLength > MAX_IMAGE_BYTES) throw Object.assign(new Error("generated_image_too_large"), { code: "image_too_large" });
    const key = `generated/${tenantId}/${requestId}/${provider}-${i + 1}.${extensionFor(contentType)}`;
    await env.ASSETS.put(key, bytes, {
      httpMetadata: { contentType, cacheControl: "private, max-age=3600" },
      customMetadata: { tenantId, requestId, provider },
    });
    stored.push({ key, content_type: contentType, size: bytes.byteLength });
  }
  return stored;
}

export async function getTenantAsset(env, key, tenantId) {
  if (!env.ASSETS) return null;
  const object = await env.ASSETS.get(key);
  if (!object) return null;
  if (object.customMetadata?.tenantId !== tenantId) return null;
  return object;
}
