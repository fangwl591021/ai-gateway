function systemPrompt(task) {
  if (task === "vision.business_card") return "Extract business card data and return concise JSON only: name, company, title, phone, mobile, email, address, website, industry, tags.";
  if (task === "vision.dm") return "Analyze the DM and return concise JSON only: title, brand, product_or_event, date, time, location, price, offer, contact, call_to_action, summary, tags.";
  return "Return a concise useful answer. Return JSON only when structured output is requested.";
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

export async function runOpenAI({ env, task, model, operation, input }) {
  if (!env.OPENAI_API_KEY) {
    const error = new Error("openai_not_configured");
    error.code = "provider_not_configured";
    throw error;
  }

  if (operation === "image.edit") {
    const error = new Error("openai_image_edit_adapter_pending_binary_input_contract");
    error.code = "operation_not_enabled";
    throw error;
  }

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
