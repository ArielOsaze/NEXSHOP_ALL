const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8").replace(/\r\n/g, "\n");

const homepageJs = read("nexshop-frontend/script.js");
const homepageCss = read("nexshop-frontend/style.css");
const homepage = read("nexshop-frontend/index.html");
const reseller = read("nexshop-frontend/reseller.html");
const resellerCss = read("nexshop-frontend/reseller.css");
const portal = read("nexshop-frontend/portal-reseller.html");
const portalCss = read("nexshop-frontend/portal-reseller.css");

const assert = (condition, message) => {
    if (!condition) throw new Error(message);
};

const rank2Js = homepageJs.match(/if \(rank === 2\)[\s\S]*?\n\s*if \(rank === 3\)/)?.[0] || "";
const rank2Css = homepageCss.match(/\.hof-podium-card--2\s*\{[\s\S]*?\n\}/)?.[0] || "";
const avatar2Css = homepageCss.match(/\.hof-avatar\.hof-avatar--2\s*\{[\s\S]*?\n\}/)?.[0] || "";

const rank2Render = homepageJs.match(/\/\/ Render Rank 2 \(Left\)[\s\S]*?\/\/ Render Rank 1/ )?.[0] || "";
assert(!/brand-indigo|from-blue|to-blue|bg-blue|border-blue/i.test(rank2Render), "rank 2 runtime component must not retain a blue/indigo accent");
assert(/style\.css\?v=20260904-mobile-card-avatar-template-2/.test(homepage), "homepage must load the current cache-busted stylesheet");
assert(/script\.js\?v=20260904-mobile-card-avatar-template-2/.test(homepage), "homepage must load the current avatar/account runtime");
assert(/silver|titanium|slate|zinc|94a3b8|cbd5e1/i.test(rank2Js + rank2Css), "rank 2 must use a silver/titanium palette");
assert(!/from-blue|to-blue|2563eb|1d4ed8|bg-blue|border-blue/i.test(rank2Js + rank2Css), "rank 2 must not use a blue palette");
assert(/hof-avatar--2[\s\S]*?(silver|titanium|slate|zinc|94a3b8|cbd5e1)/i.test(homepageJs + homepageCss), "rank 2 profile avatar must retain an explicit titanium frame");
assert(/padding:\s*3px\s*!important/i.test(avatar2Css), "rank 2 avatar frame must stay slim at 3px");
assert(!/0 0 0 2px/i.test(avatar2Css), "rank 2 avatar frame must not use an oversized outer ring");
assert(/rgba\(100,\s*116,\s*139,\s*0\)/i.test(avatar2Css), "rank 2 avatar frame must fade to transparent at the bottom");
assert(/tanpa minimum transaksi bulanan/i.test(reseller), "Silver landing tier must explicitly say there is no monthly minimum");
assert(/rs-tier-card-silver[\s\S]*#(?:94a3b8|9ca3af|b8c2cf|cbd5e1|64748b)/i.test(resellerCss), "Silver landing tier must use a metallic silver palette");
assert(/rs-tier-card-platinum[\s\S]*#(?:e5e4e2|a7b0bb|c8ced4)/i.test(resellerCss), "Platinum landing tier must use a referenced platinum neutral palette");
assert(/visualByCode|tierVisual|tv-tier-platinum|tv-tier-silver/.test(portal), "Portal tier renderer must map colors by tier code");
assert(/tv-portal-tier-card\.tv-tier-silver|tv-tier-silver/.test(portalCss) && /tv-portal-tier-card\.tv-tier-platinum|tv-tier-platinum/.test(portalCss), "Portal must have distinct Silver and Platinum visual tokens");
assert(/#(?:e5e4e2|a7b0bb|c8ced4)/i.test(portalCss), "Portal Platinum must use the referenced platinum neutral accent");

console.log("PASS sim87: titanium rank-2 avatar/card frame and distinct Silver/Gold/Platinum palettes");
