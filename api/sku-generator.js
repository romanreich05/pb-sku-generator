const crypto = require("crypto");

const STORES = {
  "b19565-81.myshopify.com": {
    abbreviation: "CC",
    token: process.env.TOKEN_CC,
    webhookSecret: process.env.WEBHOOK_SECRET_CC,
  }
};

function getProductType(title) {
  const t = title.toUpperCase();
  if (t.includes("OVERSIZED SHIRT")) return "OS";
  if (t.includes("OVERSIZED HOODIE")) return "OH";
  if (t.includes("BASIC SHIRT")) return "TS";
  if (t.includes("REGULAR SHIRT")) return "TS";
  if (t.includes("BASIC HOODIE")) return "HO";
  if (t.includes("REGULAR HOODIE")) return "HO";
  if (t.includes("T-SHIRT")) return "TS";
  if (t.includes("LONGSLEEVE")) return "LS";
  if (t.includes("JERSEY")) return "OS";
  if (t.includes("HOODIE")) return "OH";
  if (t.includes("SHIRT")) return "OS";
  return "XX";
}

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

function generateSKU(abbreviation, productType, title, variantTitle) {
  // Produkttyp + Name aus Titel extrahieren (Produkttyp-Keywords entfernen)
  const cleanTitle = title
    .toUpperCase()
    .replace(/OVERSIZED SHIRT|OVERSIZED HOODIE|BASIC SHIRT|REGULAR SHIRT|BASIC HOODIE|REGULAR HOODIE|T-SHIRT|LONGSLEEVE|JERSEY|HOODIE|SHIRT/g, "")
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 12);
  const variantPart = variantTitle && variantTitle !== "Default Title"
    ? "-" + variantTitle.toUpperCase().replace(/[^A-Z0-9]+/g, "-").slice(0, 6)
    : "";
  const suffix = crypto.randomBytes(2).toString("hex").toUpperCase();
  return `PB-${abbreviation}-${productType}-${cleanTitle}${variantPart}-${suffix}`;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).end();

  const shopDomain = req.headers["x-shopify-shop-domain"];
  const store = STORES[shopDomain];
  if (!store) return res.status(200).json({ message: "Unknown store" });

  let rawBody = "";
  if (typeof req.body === "string") {
    rawBody = req.body;
  } else if (req.body && typeof req.body === "object") {
    rawBody = JSON.stringify(req.body);
  } else {
    rawBody = await new Promise(resolve => {
      let data = "";
      req.on("data", chunk => data += chunk);
      req.on("end", () => resolve(data));
    });
  }

  // TEMP: HMAC disabled
  // const hmac = req.headers["x-shopify-hmac-sha256"];
  // const hash = crypto.createHmac("sha256", store.webhookSecret).update(rawBody).digest("base64");
  // if (hash !== hmac) return res.status(401).end();

  try {
    const product = typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;
    console.log("Product received:", product.id, product.title);

    const productType = getProductType(product.title);
    console.log("Product type:", productType);

    const existingSKUs = await getAllSKUs(shopDomain, store.token);
    console.log("Existing SKUs loaded:", existingSKUs.size);

    for (const variant of product.variants || []) {
      if (variant.sku?.startsWith("PB-") && !existingSKUs.has(variant.sku)) continue;
      let sku, attempts = 0;
      do {
        sku = generateSKU(store.abbreviation, productType, product.title, variant.title || "");
        attempts++;
      } while (existingSKUs.has(sku) && attempts < 10);
      const putRes = await fetch(`https://${shopDomain}/admin/api/2024-01/variants/${variant.id}.json`, {
        method: "PUT",
        headers: { "X-Shopify-Access-Token": store.token, "Content-Type": "application/json" },
        body: JSON.stringify({ variant: { id: variant.id, sku } })
      });
      console.log(`SKU gesetzt: ${variant.title} → ${sku} (${putRes.status})`);
      await new Promise(r => setTimeout(r, 300));
    }

    res.status(200).json({ message: "Done" });
  } catch(e) {
    console.error("ERROR:", e.message);
    res.status(500).json({ error: e.message });
  }
};
