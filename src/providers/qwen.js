function configForRegion(env, region) {
  if (region === "cn") {
    if (!env.QWEN_CN_API_KEY || !env.QWEN_CN_WORKSPACE_ID) {
      throw new Error("qwen_cn_not_configured");
    }
    return {
      apiKey: env.QWEN_CN_API_KEY,
      baseUrl: `https://${env.QWEN_CN_WORKSPACE_ID}.cn-beijing.maas.aliyuncs.com`,
    };
  }

  if (!env.QWEN_INTL_API_KEY || !env.QWEN_INTL_WORKSPACE_ID) {
    throw new Error("qwen_intl_not_configured");
  }
  return {
    apiKey: env.QWEN_INTL_API_KEY,
    baseUrl: `https://${env.QWEN_INTL_WORKSPACE_ID}.ap-southeast-1.maas.aliyuncs.com`,
  };
}

async function parseProviderJson(response) {
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(body?.message || body?.error?.message || `qwen_http_${response.status}`);
    error.code = body?.code || body?.error?.code || `http_${response.status}`;
    error.status = response.status;
    throw error;
  }
  return body;
}

function normalizeTextInput(task, input) {
  if (typeof input === "string") return input;
  if (typeof input?.text === "string") return input.text;
  if (typeof input?.prompt === "string") return input.prompt;
  throw new Error(`${task}_text_required`);
}

function systemPromptForTask(task) {
  if (task === "vision.business_card") {
    return "Extract business card data. Return concise JSON only with name, company, title, phone, mobile, email, address, website, industry, tags. Preserve Traditional Chinese where present.";
  }
  if (task === "vision.dm") {
    return "Analyze the promotional DM. Return concise JSON only with title, brand, product_or_event, date, time, location, price, offer, contact, call_to_action, summary, tags.";
  }
  return "Return a concise, useful answer. If the request asks for structured data, return valid JSON only.";
}

async function callChat({ env, region, task, model, input }) {
  const cfg = configForRegion(env, region);
  const isVision = task.startsWith("vision.");
  let userContent;

  if (isVision) {
    const imageUrl = input?.image_url || input?.image;
    if (!imageUrl) throw new Error(`${task}_image_required`);
    userContent = [
      { type: "image_url", image_url: { url: imageUrl } },
      { type: "text", text: input?.prompt || "Analyze this image according to the system instruction." },
    ];
  } else {
    userContent = normalizeTextInput(task, input);
  }

  const response = await fetch(`${cfg.baseUrl}/compatible-mode/v1/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${cfg.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPromptForTask(task) },
        { role: "user", content: userContent },
      ],
      temperature: 0.1,
    }),
  });

  const body = await parseProviderJson(response);
  const text = body?.choices?.[0]?.message?.content ?? "";
  return {
    result: text,
    providerRequestId: body?.request_id || body?.id || null,
    usage: {
      inputUnits: body?.usage?.prompt_tokens || 0,
      outputUnits: body?.usage?.completion_tokens || 0,
      imageCount: 0,
    },
  };
}

function imagePrompt(task, input) {
  const custom = input?.prompt?.trim();
  if (custom) return custom;
  if (task === "image.tryon.glasses") {
    return "Use the first image as the person's base photo and the second image as the glasses reference. Put the glasses naturally on the person's face. Preserve identity, facial proportions, skin texture, hairstyle, expression, background, lighting and photorealism. Match perspective, scale, reflections, occlusion and shadows. Do not alter unrelated facial features.";
  }
  if (task === "image.hairstyle") {
    return "Use the first image as the person's base photo and the second image as hairstyle reference when provided. Change only the hairstyle while preserving the person's identity, facial features, skin texture, expression, body, clothing, background and lighting. Make hairline, strands, volume, shadows and occlusion photorealistic.";
  }
  return "Edit the image according to the supplied references while preserving identity and photorealism.";
}

async function callImageEdit({ env, region, task, model, input }) {
  const cfg = configForRegion(env, region);
  const images = [];
  if (input?.image_url) images.push(input.image_url);
  if (input?.product_image_url) images.push(input.product_image_url);
  if (input?.reference_image_url) images.push(input.reference_image_url);
  if (Array.isArray(input?.images)) images.push(...input.images);

  const uniqueImages = [...new Set(images.filter(Boolean))].slice(0, 3);
  if (!uniqueImages.length) throw new Error(`${task}_image_required`);

  const content = uniqueImages.map((image) => ({ image }));
  content.push({ text: imagePrompt(task, input) });

  const response = await fetch(`${cfg.baseUrl}/api/v1/services/aigc/multimodal-generation/generation`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${cfg.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: { messages: [{ role: "user", content }] },
      parameters: {
        n: 1,
        watermark: false,
        prompt_extend: input?.prompt_extend ?? true,
        size: input?.size || "1536*1536",
        negative_prompt: input?.negative_prompt || "低畫質，臉部變形，身份改變，眼鏡變形，髮絲模糊，不自然光影，錯誤透視，AI感",
      },
    }),
  });

  const body = await parseProviderJson(response);
  const generated = body?.output?.choices?.[0]?.message?.content || [];
  const imagesOut = generated.map((item) => item?.image).filter(Boolean);
  if (!imagesOut.length) throw new Error("qwen_image_result_missing");

  return {
    result: { images: imagesOut, expires_in_hours: 24 },
    providerRequestId: body?.request_id || null,
    usage: {
      inputUnits: 0,
      outputUnits: 0,
      imageCount: body?.usage?.image_count || imagesOut.length,
    },
  };
}

export async function runQwen(args) {
  if (args.operation === "image.edit") return callImageEdit(args);
  return callChat(args);
}
