const IMAGE_EDIT_TASKS = new Set([
  "image.tryon.glasses",
  "image.hairstyle",
]);

export function inferRegion(request, requestedRegion) {
  if (requestedRegion === "cn" || requestedRegion === "global") return requestedRegion;
  return request.cf?.country === "CN" ? "cn" : "global";
}

export function buildRoute(task, region) {
  if (region === "cn") {
    if (IMAGE_EDIT_TASKS.has(task)) {
      return [
        { provider: "qwen", model: "qwen-image-2.0-pro", operation: "image.edit" },
        { provider: "qwen", model: "qwen-image-2.0", operation: "image.edit" },
      ];
    }
    if (task === "vision.business_card" || task === "vision.dm") {
      return [
        { provider: "qwen", model: "qwen3-vl-flash", operation: "vision.analyze" },
      ];
    }
    return [
      { provider: "qwen", model: "qwen-plus", operation: "text.analyze" },
    ];
  }

  if (IMAGE_EDIT_TASKS.has(task)) {
    return [
      { provider: "openai", model: "gpt-image-2", operation: "image.edit" },
      { provider: "qwen", model: "qwen-image-2.0-pro", operation: "image.edit" },
    ];
  }

  if (task === "vision.business_card" || task === "vision.dm") {
    return [
      { provider: "qwen", model: "qwen3-vl-flash", operation: "vision.analyze" },
      { provider: "openai", model: "gpt-5.6-luna", operation: "vision.analyze" },
    ];
  }

  return [
    { provider: "qwen", model: "qwen-plus", operation: "text.analyze" },
    { provider: "openai", model: "gpt-5.6-luna", operation: "text.analyze" },
  ];
}
