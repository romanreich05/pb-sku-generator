const crypto = require("crypto");

const STORES = {
  "b19565-81.myshopify.com": {
    abbreviation: "CC",
    token: process.env.TOKEN_CC,
    webhookSecret: process.env.WEBHOOK_SECRET_CC,
  }
};

async function getAllSKUs(shopDomain, token) {
  const skus = new Set();
  let url = `https://${shopDomain}/admin/api/2024-01/variants.json?limit=250&fields=sku`;
  while (url) {
    const res = await fetch(url, { headers: { "X-Shopify-Access-Token": token } });
    const data = await res.json();
    data.variants?.forEach(v => v.sku && skus.add(v.sku));
    const link = res.headers.get("link") || "";
    const next = link.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : null;
  }
  return skus;
}

function generateSKU(abbreviation, title, variantTitle) {
  const titlePart = title.toUpperCase().replace(/[^A-Z0-9]+/g, "-").slice(0, 12);
  const variantPart = variantTitle ? "-" + variantTitle.toUpperCase().replace(/[^A-Z0-9]+/g, "-").slice(0, 6) : "";
  const suffix = crypto.randomBytes(2).toString("hex").toUpperCase();
  return `PB-${abbreviation}-${titlePart}${variantPart}-${suffix}`;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).end();
  const shopDomain = req.headers["x-shopify-shop-domain"];
  const store = STORES[shopDomain];
  if (!store) return res.status(200).json({ message: "Unknown store" });

  const rawBody = await new Promise(resolve => {
    let data = "";
    req.on("data", chunk => data += chunk);
    req.on("end", () => resolve(data));
  });

  const hmac = req.headers["x-shopify-hmac-sha256"];
  const hash = crypto.createHmac("sha256", store.webhookSecret).update(rawBody).digest("base64");
  // TEMP: if (hash !== hmac) return res.status(401).end();

  res.status(200).json({ message: "Processing" });

  try {
    const product = JSON.parse(rawBody);
    const existingSKUs = await getAllSKUs(shopDomain, store.token);
    for (const variant of product.variants || []) {
      if (variant.sku?.startsWith("PB-") && !existingSKUs.has(variant.sku)) continue;
      let sku, attempts = 0;
      do {
        sku = generateSKU(store.abbreviation, product.title, variant.title || "");
        attempts++;
      } while (existingSKUs.has(sku) && attempts < 10);
      await fetch(`https://${shopDomain}/admin/api/2024-01/variants/${variant.id}.json`, {
        method: "PUT",
        headers: { "X-Shopify-Access-Token": store.token, "Content-Type": "application/json" },
        body: JSON.stringify({ variant: { id: variant.id, sku } })
      });
      console.log(`SKU gesetzt: ${variant.title} → ${sku}`);
      await new Promise(r => setTimeout(r, 300));
    }
  } catch(e) { console.error(e.message); }
};
