import { createHash, randomBytes, randomUUID } from "node:crypto";

const environment = process.argv[2] === "test" ? "test" : "live";
const tenantName = process.argv.slice(3).join(" ") || "First Tenant";
const tenantId = `ten_${randomUUID().replaceAll("-", "")}`;
const apiKeyId = `key_${randomUUID().replaceAll("-", "")}`;
const secret = randomBytes(24).toString("base64url");
const apiKey = `agw_${environment}_${secret}`;
const keyHash = createHash("sha256").update(apiKey).digest("hex");
const prefix = apiKey.slice(0, 16);

console.log("\nAI Gateway credential generated\n");
console.log(`Tenant: ${tenantName}`);
console.log(`Tenant ID: ${tenantId}`);
console.log(`API Key: ${apiKey}`);
console.log("IMPORTANT: save the API Key now. Only its hash should be stored in D1.\n");
console.log("Run this SQL against D1:\n");
console.log(`INSERT INTO tenants (id, name) VALUES ('${tenantId}', '${tenantName.replaceAll("'", "''")}');`);
console.log(`INSERT INTO api_keys (id, tenant_id, name, key_prefix, key_hash) VALUES ('${apiKeyId}', '${tenantId}', 'default', '${prefix}', '${keyHash}');`);
