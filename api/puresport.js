// api/puresport.js
const fs = require("fs");
const path = require("path");

module.exports = async (req, res) => {
  try {
    const productsDir = path.join(process.cwd(), "products");
    const files = fs.readdirSync(productsDir).filter(f => f.endsWith(".json"));
    const products = files.map(f =>
      JSON.parse(fs.readFileSync(path.join(productsDir, f), "utf8"))
    );

    // detect ?format=html
    const url = new URL(req.url, `http://${req.headers.host}`);
    const wantHTML =
      url.searchParams.get("format") === "html" ||
      (req.headers.accept || "").includes("text/html");

    if (wantHTML) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.status(200).end(renderHTML(products));
      return;
    }

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(200).json({
      updated_at: new Date().toISOString(),
      count: products.length,
      products,
    });
  } catch (e) {
    res.status(500).send(`Server error: ${e.message}`);
  }
};

function renderHTML(all) {
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = c => typeof c === "number" ? new Intl.NumberFormat("en-GB",{style:"currency",currency:"GBP"}).format(c/100) : "";
  return `<!doctype html><meta charset="utf-8"><title>Puresport KB</title>
  <style>body{font-family:system-ui,Arial;margin:24px;line-height:1.6}article{border-top:1px solid #eaeaea;padding-top:16px;margin-top:16px}</style>
  <h1>Puresport product knowledge base</h1><p>Products: ${all.length}</p>
  ${all.map(p => `
    <article>
      <h2>${esc(p.title || p.handle)}</h2>
      ${p.price_from_cents ? `<p><b>From:</b> ${money(p.price_from_cents)}</p>` : ""}
      ${(p.sections||[]).map(s => `<h3>${esc(s.heading)}</h3><p>${esc(s.body)}</p>`).join("")}
    </article>
  `).join("")}`;
}