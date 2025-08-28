const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const INPUT = "product-urls.txt";
const OUTDIR = "products";
const CONCURRENCY = 1;         // keep 1 to be polite; you can raise to 2–3 if needed
const DELAY_MS = 1200;         // time between starts per worker (polite throttling)

if (!fs.existsSync(OUTDIR)) fs.mkdirSync(OUTDIR, { recursive: true });

const urls = fs.readFileSync(INPUT, "utf8").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
let i = 0, active = 0, done = 0;

function next() {
  if (i >= urls.length) return;
  if (active >= CONCURRENCY) return;

  const url = urls[i++];
  const handle = url.split("/").filter(Boolean).pop();
  const outfile = path.join(OUTDIR, `product-${handle}.json`);

  // Skip if already scraped
  if (fs.existsSync(outfile)) {
    console.log(`[skip] ${handle} (exists)`);
    setTimeout(next, 10);
    return;
  }

  active++;
  console.log(`[run]  ${handle}`);

  const child = spawn(process.execPath, ["scrape-pdp.cjs", url], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "", err = "";

  child.stdout.on("data", d => out += d);
  child.stderr.on("data", d => err += d);

  child.on("close", (code) => {
    active--; done++;
    if (code !== 0) {
      console.error(`[fail] ${handle}: ${err || out}`);
    } else {
      // Move saved file into OUTDIR (scrape-pdp saves in CWD)
      const saved = `product-${handle}.json`;
      if (fs.existsSync(saved)) {
        fs.renameSync(saved, outfile);
      }
      // append to simple index
      fs.appendFileSync("products-index.csv",
        `${handle},"${url.replace(/"/g,'""')}"\n`, "utf8");
      console.log(`[ok]   ${handle} (${done}/${urls.length})`);
    }
    setTimeout(next, DELAY_MS);
  });

  // Start more if slots free
  if (active < CONCURRENCY) setTimeout(next, DELAY_MS);
}

// header for index
if (!fs.existsSync("products-index.csv")) {
  fs.writeFileSync("products-index.csv", "handle,url\n", "utf8");
}

// kick off
for (let k = 0; k < CONCURRENCY; k++) next();