import { fetchRemoteImage } from "../assets.js";

function systemPrompt(task) {
  if (task === "vision.business_card") return "Extract business card data and return concise JSON only: name, company, title, phone, mobile, email, address, website, industry, tags.";
  if (task === "vision.dm") return "Analyze the DM and return concise JSON only: title, brand, product_or_event, date, time, location, price, offer, contact, call_to_action, summary, tags.";
  return "Return a concise useful answer. Return JSON only when structured output is requested.";
}

function imagePrompt(task, input) {
  if (input?.prompt?.trim()) return input.prompt.trim();
  if (task === "image.tryon.glasses") {
    return "Use the first image as the person's base photo and the second image as the glasses reference. Put the glasses naturally on the person's face. Preserve identity, facial proportions, skin texture, hairstyle, expression, background, lighting and photorealism. Match perspective, scale, reflections, occlusion and shadows. Do not alter unrelated facial features.";
  }
  if (task === "image.hairstyle") {
    return "Use the first image as the person's base photo and the second image as hairstyle reference when provided. Change only the hairstyle while preserving identity, facial features, skin texture, expression, body, clothing, background and lighting. Make the hairline, strands, volume, shadows and occlusion photorealistic.";
  }
  return "Edit the supplied images while preserving identity and photorealism.";
}

async function parseJson(response) {
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(body?.error?.message || `openai_http_${response.status}`);
    error.code = body?.error?.code || `http_${response.status}`;
    throw error;
  }
  return body;
}

function inputImageUrls(input) {
  const urls = [];
  if (input?.image_url) urls.push(input.image_url);
  if (input?.product_image_url) urls.push(input.product_image_url);
  if (input?.reference_image_url) urls.push(input.reference_image_url);
  if (Array.isArray(input?.images)) urls.push(...input.images);
  return [...new Set(urls.filter(Boolean))].slice(0, 4);
}

async function callImageEdit({ env, task, model, input }) {
  const urls = inputImageUrls(input);
  if (!urls.length) throw Object.assign(new Error(`${task}_image_required`), { code: "image_required" });

  const form = new FormData();
  form.set("model", model);
  form.set("prompt", imagePrompt(task, input));
  form.set("quality", input?.quality || "high");
  form.set("size", input?.size || "1024x1024");
  form.set("input_fidelity", input?.input_fidelity || "high");
  form.set("n", "1");

  for (let i = 0; i < urls.length; i += 1) {
    const { bytes, contentType } = await fetchRemoteImage(urls[i]);
    const ext = contentType === "image/jpeg" ? "jpg" : contentType === "image/webp" ? "webp" : "png";
    form.append("image[]", new Blob([bytes], { type: contentType }), `input-${i + 1}.${ext}`);
  }

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: form,
  });
  const body = await parseJson(response);
  const images = (body?.data || []).map((item) => item?.b64_json || item?.url).filter(Boolean);
  if (!images.length) throw Object.assign(new Error("openai_image_result_missing"), { code: "image_result_missing" });
  return {
    result: { images },
    providerRequestId: body?.id || null,
    usage: { inputUnits: 0, outputUnits: 0, imageCount: images.length },
  };
}

export async function runOpenAI({ env, task, model, operation, input }) {
  if (!env.OPENAI_API_KEY) {
    const error = new Error("openai_not_configured");
    error.code = "provider_not_configured";
    throw error;
  }

  if (operation === "image.edit") return callImageEdit({ env, task, model, input });

  const content = [];
  if (task.startsWith("vision.")) {
    const imageUrl = input?.image_url || input?.image;
    if (!imageUrl) throw new Error(`${task}_image_required`);
    content.push({ type: "input_image", image_url: imageUrl });
    content.push({ type: "input_text", text: input?.prompt || systemPrompt(task) });
  } else {
    const text = typeof input === "string" ? input : input?.text || input?.prompt;
    if (!text) throw new Error(`${task}_text_required`);
    content.push({ type: "input_text", text });
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      instructions: systemPrompt(task),
      input: [{ role: "user", content }],
    }),
  });

  const body = await parseJson(response);
  const outputText = body?.output_text || body?.output?.flatMap((item) => item?.content || []).find((item) => item?.type === "output_text")?.text || "";
  return {
    result: outputText,
    providerRequestId: body?.id || null,
    usage: {
      inputUnits: body?.usage?.input_tokens || 0,
      outputUnits: body?.usage?.output_tokens || 0,
      imageCount: 0,
    },
  };
}
