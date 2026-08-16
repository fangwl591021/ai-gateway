function number(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export async function calculateProviderCost(env, { provider, model, region, usage }) {
  const price = await env.DB.prepare(
    `SELECT unit_type, input_price, output_price, image_price, currency
     FROM provider_prices
     WHERE provider = ?1 AND model = ?2 AND (region = ?3 OR region = 'global')
       AND effective_from <= datetime('now')
       AND (effective_to IS NULL OR effective_to > datetime('now'))
     ORDER BY CASE WHEN region = ?3 THEN 0 ELSE 1 END, effective_from DESC
     LIMIT 1`
  ).bind(provider, model, region).first();

  if (!price) {
    return { currency: null, amount: 0, twd: 0, priced: false };
  }

  const inputUnits = number(usage?.inputUnits);
  const outputUnits = number(usage?.outputUnits);
  const imageCount = number(usage?.imageCount);
  let amount = 0;

  if (price.unit_type === "tokens_per_million") {
    amount = (inputUnits / 1_000_000) * number(price.input_price)
      + (outputUnits / 1_000_000) * number(price.output_price);
  } else if (price.unit_type === "image") {
    amount = imageCount * number(price.image_price);
  } else if (price.unit_type === "mixed") {
    amount = (inputUnits / 1_000_000) * number(price.input_price)
      + (outputUnits / 1_000_000) * number(price.output_price)
      + imageCount * number(price.image_price);
  }

  const currency = String(price.currency || "").toUpperCase();
  const cnyTwd = number(env.CNY_TWD_RATE, 4.75);
  const usdTwd = number(env.USD_TWD_RATE, 30.0);
  const twd = currency === "CNY" ? amount * cnyTwd
    : currency === "USD" ? amount * usdTwd
    : currency === "TWD" ? amount
    : 0;

  return { currency, amount, twd, priced: true };
}

export async function calculateBillable(env, { tenantId, task, providerCostTwd }) {
  const rate = await env.DB.prepare(
    `SELECT billing_type, markup_percent, fixed_price_twd
     FROM tenant_rate_cards
     WHERE tenant_id = ?1 AND task = ?2
     LIMIT 1`
  ).bind(tenantId, task).first();

  if (rate?.billing_type === "fixed") {
    return Math.max(0, number(rate.fixed_price_twd));
  }
  if (rate?.billing_type === "pass_through") {
    return Math.max(0, providerCostTwd);
  }

  let markup = rate?.markup_percent;
  if (markup === null || markup === undefined) {
    const tenant = await env.DB.prepare(
      `SELECT markup_percent FROM tenants WHERE id = ?1 LIMIT 1`
    ).bind(tenantId).first();
    markup = tenant?.markup_percent;
  }

  return Math.max(0, providerCostTwd * (1 + number(markup, 30) / 100));
}
