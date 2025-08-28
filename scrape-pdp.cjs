// scrape-pdp.cjs
// Node 18 compatible. Run: node scrape-pdp.cjs <PRODUCT_URL>
// Deps: npm i cheerio@1.0.0-rc.12

const fs = require("fs");
const path = require("path");
const https = require("https");
const { URL } = require("url");
const cheerio = require("cheerio");

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-GB,en;q=0.9",
  "Accept-Encoding": "identity", // avoid gzip/brotli to keep it simple
  Connection: "close",
};

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      protocol: u.protocol,
      hostname: u.hostname,
      path: u.pathname + (u.search || ""),
      headers: HEADERS,
    };
    https
      .get(opts, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const next = new URL(res.headers.location, url).toString();
          return resolve(httpGet(next));
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
      })
      .on("error", reject);
  });
}

const abs = (u) => (u?.startsWith("//") ? "https:" + u : u);
const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
const textify = ($el) =>
  $el
    .clone()
    .find("script,style,noscript")
    .remove()
    .end()
    .text()
    .replace(/\u00A0/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

function toMoney(cents, currency = "GBP") {
  return typeof cents === "number"
    ? new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(cents / 100)
    : "";
}
function parseGBPToCents(txt) {
  if (!txt) return null;
  const num = txt.replace(/[^\d.,]/g, "").replace(",", ".");
  const f = parseFloat(num);
  return Number.isFinite(f) ? Math.round(f * 100) : null;
}

function dbg(...args) {
  console.log("[scrape]", ...args);
}

function parseJsonLdCurrency($) {
  let currency = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const raw = $(el).contents().text();
      const data = JSON.parse(raw);
      const nodes = Array.isArray(data) ? data : [data];
      for (const n of nodes) {
        if (
          n && typeof n === "object" &&
          (n["@type"] === "Product" || (Array.isArray(n["@type"]) && n["@type"].includes("Product")))
        ) {
          const offers = n.offers;
          if (Array.isArray(offers) && offers[0]?.priceCurrency) { currency = offers[0].priceCurrency; return false; }
          if (offers && offers.priceCurrency) { currency = offers.priceCurrency; return false; }
        }
      }
    } catch {}
  });
  return currency; // e.g. "GBP" or null
}

function extractSubscriptionAndOneTime($) {
  const out = { subscription: null, one_time: null };
  const $wrap = $(".custom-subscription-widget__wrapper").first();
  if ($wrap.length === 0) return out;

  // ---------- SUBSCRIPTION ----------
  const $subContainer = $wrap
    .find(".custom-subscription-widget__container.custom-subscription-widget__container-js")
    .first();

  if ($subContainer.length) {
    const sub = {
      plan: "subsave",
      selling_plan_id: null,
      banner: null,
      price_current: null,
      price_current_cents: null,
      price_compare_at: null,
      price_compare_at_cents: null,
      savings_breakdown: [],
      ongoing: [],
      free_gift: null,
    };

    // plan id
    const planIdAttr = $wrap.attr("data-selling-plan-id");
    const hiddenPlan = $subContainer.find('input[name="selling_plan"]').attr("value");
    sub.selling_plan_id = planIdAttr || hiddenPlan || null;

    // banner
    sub.banner = norm(
      $subContainer.find(".custom-subscription-widget__container-banner .metafield-rich_text_field").text()
    ) || null;

    // main sub price block (current + compare)
    // primary selector
    let $priceBlock = $subContainer.find(".form-field__group .subscription_price").first();
    // fallback: the right-aligned price span in the first plan row
    if (!$priceBlock.length) {
      $priceBlock = $subContainer.find(".custom-radio__label .subscription_price").first();
    }
    if ($priceBlock.length) {
      const currentTxt = norm($priceBlock.text());
      sub.price_current = currentTxt || null;
      sub.price_current_cents = parseGBPToCents(currentTxt);

      const compareTxt =
        norm($priceBlock.prev("s").text()) ||                 // immediate <s> sibling
        norm($priceBlock.closest("span").prev("s").text()) || // <s> before parent span
        null;
      sub.price_compare_at = compareTxt || null;
      sub.price_compare_at_cents = parseGBPToCents(compareTxt);
    }

    // savings breakdown rows (also as fallback sources for prices)
    $subContainer.find(".ps-saving-dropdown-body ul li").each((_, li) => {
      const $li = $(li);
      const label = norm($li.find("span").first().text());
      const was = norm($li.find("s").first().text());
      // prefer the “badge” span, else fall back to the last span on the row
      let now = norm($li.find("span.ps-rounded-[20px]").first().text());
      if (!now) {
        const spans = $li.find("span");
        if (spans.length) now = norm($(spans.get(spans.length - 1)).text());
      }
      if (label) {
        sub.savings_breakdown.push({
          label,
          price_was: was || null,
          price_was_cents: parseGBPToCents(was),
          price_now: now || null,
          price_now_cents: parseGBPToCents(now),
        });
      }
    });

    // derive price_current/compare if still missing
    if (!sub.price_current || !sub.price_compare_at) {
      // try “Save 30% on your first order”
      const firstOrder = sub.savings_breakdown.find((r) =>
        /first order/i.test(r.label || "")
      );
      if (firstOrder) {
        if (!sub.price_current && firstOrder.price_now) {
          sub.price_current = firstOrder.price_now;
          sub.price_current_cents = firstOrder.price_now_cents;
        }
        if (!sub.price_compare_at && firstOrder.price_was) {
          sub.price_compare_at = firstOrder.price_was;
          sub.price_compare_at_cents = firstOrder.price_was_cents;
        }
      }
      // else try any row that has both was/now
      if (!sub.price_current || !sub.price_compare_at) {
        const any = sub.savings_breakdown.find((r) => r.price_now && r.price_was);
        if (any) {
          if (!sub.price_current) {
            sub.price_current = any.price_now;
            sub.price_current_cents = any.price_now_cents;
          }
          if (!sub.price_compare_at) {
            sub.price_compare_at = any.price_was;
            sub.price_compare_at_cents = any.price_was_cents;
          }
        }
      }
    }

    // ongoing bullets
    $subContainer.find("ul.ps-flex.ps-flex-col li .text-minor.text-bold").each((_, p) => {
      const txt = norm($(p).text());
      if (txt) sub.ongoing.push(txt);
    });

    // free gift JSON
    const freeGiftRaw = $subContainer.find('script[type="application/json"][data-free-product]').html();
    if (freeGiftRaw) {
      try {
        const parsed = JSON.parse(freeGiftRaw);
        if (parsed && parsed.free_product) {
          const fg = parsed.free_product;
          const fix = (u) => (u && u.startsWith("//") ? "https:" + u : u);
          fg.images = Array.isArray(fg.images) ? fg.images.map(fix) : fg.images;
          fg.featured_image = fix(fg.featured_image);
          sub.free_gift = fg;
        }
      } catch {}
    }

    out.subscription = sub;
  }

  // ---------- ONE-TIME ----------
  // Robust search: find the radio input with id="oneTimePurchase", then scan nearby for a price
  let onePrice = null;
  const $oneInput = $wrap.find("#oneTimePurchase").first();
  if ($oneInput.length) {
    const $block = $oneInput.closest(".ps-p-4.ps-border, .form-field__group, .custom-radio__label");
    // common cases
    onePrice =
      norm($block.find(".subscription_price.ps-text-brand-black").first().text()) ||
      norm($block.find(".subscription_price").first().text()) ||
      // ultra fallback: any currency-looking span in this block
      (() => {
        let found = null;
        $block.find("span").each((_, s) => {
          const t = norm($(s).text());
          if (/£\s*\d/.test(t)) { found = t; return false; }
        });
        return found;
      })() ||
      null;
  }

  out.one_time = {
    price: onePrice,
    price_cents: parseGBPToCents(onePrice),
  };

  return out;
}

async function scrapeProduct(productUrl) {
  dbg("HTML:", productUrl);
  const html = await httpGet(productUrl);
  const $ = cheerio.load(html);

  const title = $("h1").first().text().trim();
  const currencyGuess = parseJsonLdCurrency($);

  // Accordions
  const sections = [];
  $(".pdp-accordion-wrapper").each((_, el) => {
    const heading = $(el)
      .find("span.ps-text-sm.ps-leading-20.ps-font-medium")
      .first()
      .text()
      .replace(/\s+/g, " ")
      .trim();
    const body = textify($(el).find(".pdp-accordion-wrapper__content").first());
    if (heading && body) {
      sections.push({ heading, body });
      dbg("Section:", heading, `(${body.length} chars)`);
    }
  });

  // Subscription / One-time
  const { subscription, one_time } = extractSubscriptionAndOneTime($);

  // Product .js
  const u = new URL(productUrl);
  const handle = u.pathname.split("/").filter(Boolean).pop();
  const productJsonUrl = `${u.origin}/products/${handle}.js`;

  let productJson = null;
  try {
    const raw = await httpGet(productJsonUrl);
    productJson = JSON.parse(raw);
  } catch (e) {
    dbg("WARN: product .js fetch/parse failed:", e.message);
  }

  const images = (productJson?.images || []).map(abs);
  const variants =
    productJson?.variants?.map((v) => ({
      id: v.id,
      title: v.title,
      sku: v.sku,
      available: v.available,
      price_cents: v.price,
      price: toMoney(v.price, currencyGuess || "GBP"),
      compare_at_price_cents: v.compare_at_price,
      compare_at_price: v.compare_at_price ? toMoney(v.compare_at_price, currencyGuess || "GBP") : "",
      barcode: v.barcode,
      weight_grams: v.grams,
      options: v.options || [],
    })) ?? [];

  const out = {
    url: productUrl,
    handle,
    id: productJson?.id ?? null,
    title: productJson?.title || title,
    vendor: productJson?.vendor || "",
    product_type: productJson?.type || productJson?.product_type || "",
    tags: productJson?.tags || [],
    price_from_cents: productJson?.price ?? null,
    price_from:
      typeof productJson?.price === "number" ? toMoney(productJson.price, currencyGuess || "GBP") : "",
    currency: currencyGuess || null,
    images,
    featured_image: productJson?.featured_image ? abs(productJson.featured_image) : images[0] || null,
    variants,
    sections,
    subscription,
    one_time,
  };

  return out;
}

// CLI
if (require.main === module) {
  const inputUrl =
    process.argv[2] ||
    "https://puresport.co/products/ultra-electrolytes-30-pack-watermelon-salt";
  scrapeProduct(inputUrl)
    .then((out) => {
      const file = `product-${out.handle || "output"}.json`;
      fs.writeFileSync(file, JSON.stringify(out, null, 2), "utf8");
      console.log("\nSaved:", path.resolve(file));
      console.log("\nPreview:", {
        title: out.title,
        currency: out.currency,
        price_from: out.price_from,
        images: out.images?.length,
        variants: out.variants?.length,
        sections: out.sections?.map((s) => s.heading),
        subscription_price: out.subscription?.price_current,
        one_time_price: out.one_time?.price,
      });
    })
    .catch((err) => {
      console.error("Error:", err.message || err);
      process.exit(1);
    });
}

module.exports = { scrapeProduct };