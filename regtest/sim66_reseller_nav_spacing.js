"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const reseller = read("nexshop-frontend/reseller.html");
const docs = read("nexshop-frontend/docs-reseller.html");
const marketplaceTheme = read("nexshop-frontend/marketplace-theme.css");

function assert(condition, message) {
    if (!condition) throw new AssertionError(message);
}

class AssertionError extends Error {
    constructor(message) {
        super(message);
        this.name = "AssertionError";
    }
}

assert(
    /<body[^>]*class="[^"]*reseller-page[^"]*"/.test(reseller),
    "halaman Program Reseller harus punya scope class reseller-page"
);
assert(
    /<body[^>]*class="[^"]*reseller-docs-page[^"]*"/.test(docs),
    "halaman docs reseller harus punya scope class reseller-docs-page"
);
assert(
    marketplaceTheme.includes(".reseller-page .mkt-nav-links") &&
        marketplaceTheme.includes(".reseller-docs-page .mkt-nav-links"),
    "navbar reseller dan docs harus memiliki scope responsive terpisah"
);
assert(
    /\.reseller-page \.mkt-nav-links\s*\{[\s\S]*?gap:\s*0\.5rem/.test(marketplaceTheme) &&
        /\.reseller-docs-page \.mkt-nav-links\s*\{[\s\S]*?gap:\s*0\.5rem/.test(marketplaceTheme),
    "dropdown reseller/docs harus memberi jarak antar item"
);
assert(
    /\.reseller-page \.mkt-nav\.is-open \.mkt-nav-links\s*\{[\s\S]*?padding:\s*0\.8rem/.test(marketplaceTheme) &&
        /\.reseller-docs-page \.mkt-nav\.is-open \.mkt-nav-links\s*\{[\s\S]*?padding:\s*0\.8rem/.test(marketplaceTheme),
    "panel dropdown reseller/docs harus punya padding internal yang lega"
);
assert(
    /\.reseller-page \.mkt-nav-links a\s*\{[\s\S]*?min-height:\s*2\.75rem/.test(marketplaceTheme) &&
        /\.reseller-docs-page \.mkt-nav-links a\s*\{[\s\S]*?min-height:\s*2\.75rem/.test(marketplaceTheme),
    "item dropdown reseller/docs harus punya target sentuh minimum 44px"
);
assert(
    reseller.includes("marketplace-theme.css?v=20260829-reseller-nav-spacing-1") &&
        docs.includes("marketplace-theme.css?v=20260829-reseller-nav-spacing-1"),
    "halaman reseller/docs harus memuat cache-buster CSS navbar terbaru"
);

console.log("PASS sim66: spacing navbar reseller/docs mobile lega dan konsisten");
