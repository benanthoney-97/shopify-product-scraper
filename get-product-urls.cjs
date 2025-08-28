const fs = require("fs");
const https = require("https");
const { XMLParser } = require("fast-xml-parser");

const ORIGIN = "https://puresport.co";
const ROOT_SITEMAP = `${ORIGIN}/sitemap.xml`;
const UA = "DialogueScraper/1.0 (+you@example.com)";

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": UA, "Accept-Encoding": "identity" }}, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(get(new URL(res.headers.location, url).toString()));
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} ${url}`));
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => body += c);
      res.on("end", () => resolve(body));
    }).on("error", reject);
  });
}

async function main() {
  console.log("[urls] fetch", ROOT_SITEMAP);
  const root = await get(ROOT_SITEMAP);
  const p = new XMLParser({ ignoreAttributes: false });
  const rootXml = p.parse(root);

  // find all child sitemaps that look like product sitemaps
  const sitemaps = (rootXml?.sitemapindex?.sitemap || [])
    .map(x => x.loc)
    .filter(loc => /sitemap_products_\d+\.xml/i.test(loc));

  if (!sitemaps.length) {
    console.error("No sitemap_products_x.xml found. (Site may use a custom sitemap.)");
    process.exit(1);
  }

  const urls = new Set();
  for (const sm of sitemaps) {
    console.log("[urls] fetch", sm);
    const xml = p.parse(await get(sm));
    const entries = xml?.urlset?.url || [];
    for (const e of entries) {
      const loc = e.loc;
      if (typeof loc === "string" && /^https?:\/\/[^ ]+\/products\//i.test(loc)) {
        urls.add(loc);
      }
    }
  }

  const list = Array.from(urls);
  fs.writeFileSync("product-urls.txt", list.join("\n") + "\n", "utf8");
  console.log(`[urls] wrote ${list.length} URLs to product-urls.txt`);
}

main().catch(err => { console.error(err); process.exit(1); });