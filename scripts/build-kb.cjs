// scripts/build-kb.cjs
// Merge all ./products/*.json into ./public/kb/puresport.md
// Usage: node scripts/build-kb.cjs

const fs = require("fs");
const path = require("path");

const IN_DIR = path.join(process.cwd(), "products");         // <- your scraped JSON folder
const OUT_DIR = path.join(process.cwd(), "public", "kb");
const OUT_FILE = path.join(OUT_DIR, "puresport.md");

function toMoney(pence, currency="GBP") {
  if (typeof pence !== "number") return "";
  const v = (pence / 100).toFixed(2);
  const symbol = currency === "GBP" ? "£" : "";
  return `${symbol}${v}`;
}

function escapeMd(s) {
  return (s || "").toString().replace(/\r/g, "").trim();
}

function productToMarkdown(p) {
  const v = (p.variants && p.variants[0]) || {};
  const tags = (p.tags || []).join("; ");
  const currency = p.currency || "GBP";

  const header = [
    `# ${escapeMd(p.title || p.handle)}`,
    `Handle: ${p.handle || ""}`,
    `Vendor: ${p.vendor || ""}`,
    `Type: ${p.product_type || ""}`,
    `Tags: ${tags}`,
    `Variant: ${v.title || ""} | SKU: ${v.sku || ""} | Barcode: ${v.barcode || ""}`,
    `Price: ${p.price_from || toMoney(p.price_from_cents, currency)}`
  ].join("\n");

  // Subscription section
  let subscription = "";
  if (p.subscription) {
    const sub = p.subscription;
    const lines = [];
    lines.push(`## Subscription`);
    if (sub.selling_plan_id) lines.push(`Selling Plan ID: ${sub.selling_plan_id}`);
    if (sub.banner) lines.push(`Banner: ${escapeMd(sub.banner)}`);
    if (Array.isArray(sub.savings_breakdown) && sub.savings_breakdown.length) {
      lines.push(`Savings:`);
      for (const s of sub.savings_breakdown) {
        const was = s.price_was || "";
        const now = s.price_now || "";
        lines.push(`- ${escapeMd(s.label)}${was ? ` (was ${was}${now ? ` → ${now}` : ""})` : ""}`);
      }
    }
    if (Array.isArray(sub.ongoing) && sub.ongoing.length) {
      lines.push(`Ongoing:`);
      for (const o of sub.ongoing) lines.push(`- ${escapeMd(o)}`);
    }
    if (sub.free_gift?.title) {
      const rrp = typeof sub.free_gift.price === "number" ? toMoney(sub.free_gift.price, currency) : "";
      lines.push(`Free Gift: ${escapeMd(sub.free_gift.title)}${rrp ? ` (RRP ${rrp})` : ""}`);
    }
    subscription = lines.join("\n");
  }

  // Sections (Description, Ingredients, etc.)
  const bodySections = (p.sections || [])
    .map(s => `\n## ${escapeMd(s.heading)}\n${escapeMd(s.body)}\n`)
    .join("");

  // Big fence to enhance chunk boundaries between products
  const fence = `\n---\n\n`;

  return `${header}\n\n${subscription ? subscription + "\n\n" : ""}${bodySections}${fence}`;
}

function main() {
  if (!fs.existsSync(IN_DIR)) {
    console.error(`Missing input dir: ${IN_DIR}`);
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const files = fs.readdirSync(IN_DIR).filter(f => f.endsWith(".json")).sort();
  if (!files.length) {
    console.error("No product JSON files found.");
    process.exit(1);
  }

  const chunks = [];
  chunks.push(`# Puresport Product Catalog\nGenerated: ${new Date().toISOString()}\n\n`);

  for (const f of files) {
    const raw = fs.readFileSync(path.join(IN_DIR, f), "utf8");
    const p = JSON.parse(raw);
    chunks.push(productToMarkdown(p));
  }

  fs.writeFileSync(OUT_FILE, chunks.join(""), "utf8");
  console.log("Wrote:", OUT_FILE);
}

main();