const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8").replace(/\r\n/g, "\n");

const reseller = read("nexshop-frontend/reseller.html");
const resellerCss = read("nexshop-frontend/reseller.css");
const portal = read("nexshop-frontend/portal-reseller.html");
const portalCss = read("nexshop-frontend/portal-reseller.css");

const assert = (condition, message) => {
    if (!condition) throw new Error(message);
};

assert(!reseller.includes("Pilihan populer"), "tier landing must not show an unrelated popular-choice badge");
assert(/rs-tier-card-silver/.test(reseller) && /rs-tier-card-gold/.test(reseller) && /rs-tier-card-platinum/.test(reseller), "tier cards must have explicit level-specific classes");
assert(/rs-tier-card-silver[\s\S]*#(?:94a3b8|b8c2cf|cbd5e1|64748b)/i.test(resellerCss), "Silver tier must use a silver frame palette");
assert(/rs-tier-card-gold[\s\S]*#(?:d97706|f59e0b|eab308)/i.test(resellerCss), "Gold tier must use a gold frame palette");
assert(/rs-tier-card-platinum[\s\S]*#(?:6d5bd0|5b4ab8|a78bfa|c4b5fd)/i.test(resellerCss), "Platinum tier must use a distinct pearl/iris palette");
assert(/Belum ada minimum transaksi bulanan/i.test(portal), "Portal must explain the Silver transaction requirement");
assert(/Rp50\.000\.000/.test(portal) && /Rp100\.000\.000/.test(portal), "Portal must explain Gold and Platinum transaction thresholds");
assert(/t\.eligibility|eligibility\.requirement/.test(portal), "Portal tier renderer must consume server-provided eligibility");
assert(/tv-tier-requirement/.test(portal), "Portal tier cards must render a visible transaction requirement");
assert(/tv-pending-banner[\s\S]*?sb687a22b9ac446|data-csp-style=\"sb687a22b9ac446\"/.test(portalCss), "Pending banner heading needs a scoped readable color override");
assert(/data-csp-style=\"sbe0deb3f9b02a8\"[^{]*\{[^}]*color:\s*(?:var\(--portal-ink-soft\)|#344054)/i.test(portalCss), "Pending banner body needs a dark readable color override");

console.log("PASS sim86: tier colors/requirements and readable pending approval notice contract");
