const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8").replace(/\r\n/g, "\n");
const readOptional = (relative) => fs.existsSync(path.join(root, relative)) ? read(relative) : "";
const article = read("nexshop-frontend/berita-artikel.html");
const articleJs = readOptional("nexshop-frontend/news-instagram-card.js");
const articleCss = readOptional("nexshop-frontend/news-instagram-card.css");
const homepageJs = read("nexshop-frontend/script.js");

const assert = (condition, message) => {
    if (!condition) throw new Error(message);
};

assert(article.includes("/news-instagram-card.css?v=20260830-news-instagram-card-1"), "News article must load the Instagram card stylesheet");
assert(article.includes("/news-instagram-card.js?v=20260830-news-instagram-card-3"), "News article must load the cache-busted Instagram card runtime");
assert(/1080/.test(articleJs) && /1920/.test(articleJs), "Instagram card must use a portrait 9:16 canvas");
assert(/const imageHeight = 820/.test(articleJs), "9:16 card must use a larger editorial thumbnail");
assert(/roundedRect\(ctx, 64, 1710, CARD_WIDTH - 128, 132/.test(articleJs), "9:16 card must have a composed footer panel instead of empty space");
assert(/navigator\.share/.test(articleJs) && /files/.test(articleJs), "Instagram card must share an image file through the native share sheet when available");
assert(/canonical[\s\S]*url:|url:\s*meta\.canonical/.test(articleJs), "native share must carry the canonical article URL");
assert(/download/.test(articleJs) && /toBlob/.test(articleJs), "Instagram card must provide a PNG download fallback");
assert(/instagram|Instagram/i.test(articleJs + articleCss), "Instagram card control must be user-visible and labeled");
const rank2Badge = homepageJs.match(/if \(rank === 2\) return '([^']+)'/)?.[1] || "";
assert(/hof-rank-badge--2/.test(rank2Badge), "rank-2 number badge must use the dedicated solid silver style");
assert(!/bg-gradient-to-br/.test(rank2Badge), "rank-2 number badge must not remain a transparent gradient");

console.log("PASS sim88: News Instagram image share card and solid silver rank-2 badge contract");
