import { runQwen } from "./qwen.js";

export async function runProvider(args) {
  if (args.provider === "qwen") return runQwen(args);

  // OpenAI/Gemini adapters are intentionally isolated behind this interface.
  // Returning a typed configuration error allows the route executor to fall back safely.
  const error = new Error(`${args.provider}_adapter_not_enabled`);
  error.code = "provider_not_enabled";
  throw error;
}
