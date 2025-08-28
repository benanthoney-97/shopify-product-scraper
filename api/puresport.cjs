// api/puresport.cjs
const fs = require("fs");
const path = require("path");

function readProducts(dir) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".json"));
  return files.map(f => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
}

function toMoney(cents, currency = "GBP") {
  return typeof cents === "number"
    ? new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(cents / 100)
    : "";
}

function htmlEscape(s = "") {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function renderHTML(all) {
  const head = `
<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="robots" content="index,follow">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Puresport Product Knowledge Base</title>
<style>
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; line-height: 1.6; margin: 24px; color:#111; }
  header { margin-bottom: 24px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .count { color:#555; }
  article { border-top: 1px solid #eaeaea; padding-top: 18px; margin-top: 18px; }
  h2 { font-size: 20px; margin: 0 0 4px; }
  .meta { color:#333; margin: 4px 0 10px; }
  .price { font-weight: 700; }
  h3 { font-size: 16px; margin: 14px 0 6px; }
  p { margin: 8px 0; white-space: pre-wrap; }
  ul { margin: 6px 0 12px 18px; }
  .section { margin: 8px 0 12px; }
</style>
<header>
  <h1>Puresport product knowledge base</h1>
  <div class="count">Products: ${all.length}</div>
  <p>This page is intentionally simple so knowledge ingestors can read it. Each product has a title, price, and sections.</p>
</header>
`;

  const body = all.map(p => {
    const price = p.price_from ?? (p.price_from_cents ? toMoney(p.price_from_cents, p.currency || "GBP") : "");
    const sections = (p.sections || []).map(s => `
      <div class="section">
        <h3>${htmlEscape(s.heading)}</h3>
        <p>${htmlEscape(s.body)}</p>
      </div>
    `).join("");

    // Optional subscription / one-time bits if present
    const sub = p.subscription ? `
      <div class="section">
        <h3>Subscription</h3>
        ${p.subscription.banner ? `<p>${htmlEscape(p.subscription.banner)}</p>` : ""}
        ${p.subscription.price_current ? `<p><span class="price">${htmlEscape(p.subscription.price_current)}</span> (was ${htmlEscape(p.subscription.price_compare_at) || "-"})</p>` : ""}
        ${(p.subscription.ongoing || []).length ? `<ul>` + p.subscription.ongoing.map(t => `<li>${htmlEscape(t)}</li>`).join("") + `</ul>` : ""}
      </div>
    ` : "";

    const one = p.one_time && (p.one_time.price || p.one_time.price_cents) ? `
      <div class="section">
        <h3>One-time purchase</h3>
        <p class="price">${htmlEscape(p.one_time.price || toMoney(p.one_time.price_cents, p.currency || "GBP"))}</p>
      </div>
    ` : "";

    return `
<article>
  <h2>${htmlEscape(p.title || p.handle)}</h2>
  <div class="meta">
    ${p.vendor ? `${htmlEscape(p.vendor)} • ` : ""}${p.product_type ? `${htmlEscape(p.product_type)} • ` : ""}<a href="${htmlEscape(p.url || "")}">${htmlEscape(p.url || "")}</a>
  </div>
  ${price ? `<p class="price">From: ${htmlEscape(price)}</p>` : ""}
  ${sub}
  ${one}
  ${sections || ""}
</article>
`;
  }).join("\n");

  return head + body + "\n</html>";
}

module.exports = async (req, res) => {
  try {
    // where your JSON files live in the Vercel project
    const productsDir = path.join(process.cwd(), "products");
    const all = readProducts(productsDir);

    // Decide format: default to JSON; use HTML if requested
    const url = new URL(req.url, `http://${req.headers.host}`);
    const format = url.searchParams.get("format");
    const accept = req.headers["accept"] || "";

    const wantHTML = format === "html" || accept.includes("text/html");

    if (wantHTML) {
      const html = renderHTML(all);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.statusCode = 200;
      res.end(html);
      return;
    }

    // JSON (original behaviour)
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.statusCode = 200;
    res.end(JSON.stringify({ updated_at: new Date().toISOString(), count: all.length, products: all }));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "text/plain");
    res.end(`Server error: ${e.message}`);
  }
};