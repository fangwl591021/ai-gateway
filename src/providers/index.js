import { runOpenAI } from "./openai.js";
import { runQwen } from "./qwen.js";

export async function runProvider(args) {
  if (args.provider === "qwen") return runQwen(args);
  if (args.provider === "openai") return runOpenAI(args);

  const error = new Error(`${args.provider}_adapter_not_enabled`);
  error.code = "provider_not_enabled";
  throw error;
}
