// api/puresport.cjs
const fs = require("fs");
const path = require("path");

module.exports = async (req, res) => {
  try {
    // Optional token protection
    const token = process.env.KB_READ_TOKEN;
    if (token && req.query.token !== token) {
      res.status(401).send("Unauthorized");
      return;
    }

    const dir = path.join(process.cwd(), "products");
    const files = fs.readdirSync(dir).filter(f => f.endsWith(".json"));

    const items = files.map(f => {
      const raw = fs.readFileSync(path.join(dir, f), "utf8");
      return JSON.parse(raw);
    });

    // Build a compact payload (adjust as you like)
    const payload = {
      source: "puresport",
      count: items.length,
      products: items
    };

    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "public, max-age=300, s-maxage=300");
    res.setHeader("access-control-allow-origin", "*");
    res.status(200).send(JSON.stringify(payload));
  } catch (e) {
    console.error(e);
    res.status(500).send(JSON.stringify({ error: String(e?.message || e) }));
  }
};