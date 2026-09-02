"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const reseller = read("nexshop-frontend/reseller.html");
const resellerCss = read("nexshop-frontend/reseller.css");
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
    /<body[^>]*class="[^"]*rs-page[^"]*"/.test(reseller),
    "halaman Program Reseller harus punya scope class rs-page"
);
assert(
    /<body[^>]*class="[^"]*reseller-docs-page[^"]*"/.test(docs),
    "halaman docs reseller harus punya scope class reseller-docs-page"
);
assert(
    reseller.includes('id="resellerNavToggle"') &&
        reseller.includes('id="resellerNavMenu"') &&
        resellerCss.includes(".rs-page.rs-menu-is-open .rs-nav-panel"),
    "navbar reseller harus memiliki panel responsive scoped"
);
assert(
    /\.rs-nav-links\s*\{[\s\S]*?gap:\s*[^;]+;/.test(resellerCss) &&
        /\.rs-page\.rs-menu-is-open \.rs-nav-panel\s*\{/.test(resellerCss) &&
        /\.rs-page\.rs-menu-is-open \.rs-nav-panel\s*\{[\s\S]*?display:\s*flex;/.test(resellerCss),
    "panel mobile reseller harus memberi jarak dan terbuka secara eksplisit"
);
assert(
    /\.rs-nav-links a\s*\{[\s\S]*?min-height:\s*44px/.test(resellerCss) &&
        /\.rs-menu-toggle\s*\{[\s\S]*?min-height:\s*44px/.test(resellerCss),
    "item navigasi reseller harus punya target sentuh minimum 44px"
);
assert(
    docs.includes("marketplace-theme.css?v=20260903-marketplace-route-2") &&
        marketplaceTheme.includes(".reseller-docs-page .mkt-nav-links"),
    "halaman docs tetap memakai kontrak navbar legacy yang tidak disentuh"
);

console.log("PASS sim66: spacing navbar reseller/docs mobile lega dan konsisten");
