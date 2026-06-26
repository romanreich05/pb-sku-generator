const crypto = require("crypto");
const STORES = {
  "b19565-81.myshopify.com": { name: "Circuit Clothing", abbreviation: "CC", token: process.env.TOKEN_CC, webhookSecret: process.env.WEBHOOK_SECRET_CC }
};
const TYPE_MAP = [["hoodie","OH"],["shirt","TS"],["tee","TS"],["crewneck","CR"],["sweater","CR"],["jogger","JP"],["shorts","SH"]];
const COLOR_MAP = [["black","BLK"],["schwarz","BLK"],["white","WHT"],["weiß","WHT"],["grey","GRY"],["gray","GRY"],["beige","BGE"],["natural","BGE"],["navy","NVY"],["blue","BLU"],["red","RED"]];
const SIZE_MAP = [["xxl","XXL"],["2xl","XXL"],["xl","XL"],["xs","XS"],["s/m","SM"],["l/xl","LXL"],["s","S"],["m","M"],["l","L"],["os","OS"]];
function match(text, map) { const l=text.toLowerCase(); for(const [k,v] of map) if(l.includes(k)) return v; return null; }
function randomId() { const c="ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; return Array.from({length:4},()=>c[Math.floor(Math.random()*c.length)]).join(""); }
function generateSKU(storeAbbr, productTitle, variantTitle) {
  return "PB-"+storeAbbr+"-"+(match(productTitle,TYPE_MAP)||"PRD")+"-"+(match(variantTitle,COLOR_MAP)||"CLR")+"-"+(match(variantTitle,SIZE_MAP)||"SZ")+"-"+randomId();
}
async function getAllSKUs(domain, token) {
  const skus=new Set(); let url=`https://${domain}/admin/api/2024-01/products.json?limit=250&fields=id,variants`;
  while(url) { const r=await fetch(url,{headers:{"X-Shopify-Access-Token":token}}); const d=await r.json(); (d.products||[]).forEach(p=>(p.variants||[]).forEach(v=>v.sku&&skus.add(v.sku))); const lh=r.headers.get("Link")||""; const m=lh.match(/page_info=([^&>]+).*rel="next"/); url=m?`https://${domain}/admin/api/2024-01/products.json?limit=250&fields=id,variants&page_info=${m[1]}`:null; }
  return skus;
}
module.exports = async function handler(req, res) {
  if(req.method!=="POST") return res.status(405).end();
  const chunks=[]; for await(const c of req) chunks.push(c); const rawBody=Buffer.concat(chunks);
  const shopDomain=req.headers["x-shopify-shop-domain"]; const store=STORES[shopDomain];
  if(!store) return res.status(200).json({message:"Unknown store"});
  const hmac=req.headers["x-shopify-hmac-sha256"];
  const hash=crypto.createHmac("sha256",store.webhookSecret).update(rawBody).digest("base64");
  if(hash!==hmac) return res.status(401).end();
  res.status(200).json({message:"Processing"});
  try {
    const product=JSON.parse(rawBody); const existingSKUs=await getAllSKUs(shopDomain,store.token);
    for(const variant of product.variants||[]) {
      if(variant.sku?.startsWith("PB-")) continue;
      let sku,attempts=0; do { sku=generateSKU(store.abbreviation,product.title,variant.title||""); attempts++; } while(existingSKUs.has(sku)&&attempts<10);
      await fetch(`https://${shopDomain}/admin/api/2024-01/variants/${variant.id}.json`,{method:"PUT",headers:{"X-Shopify-Access-Token":store.token,"Content-Type":"application/json"},body:JSON.stringify({variant:{id:variant.id,sku}})});
      console.log(`SKU gesetzt: ${variant.title} → ${sku}`);
      await new Promise(r=>setTimeout(r,300));
    }
  } catch(e) { console.error(e.message); }
};
