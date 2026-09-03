"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const css = fs.readFileSync(path.join(root, "nexshop-frontend", "style.css"), "utf8").replace(/\r\n/g, "\n");
const resellerCss = fs.readFileSync(path.join(root, "nexshop-frontend", "reseller.css"), "utf8").replace(/\r\n/g, "\n");
const resellerJs = fs.readFileSync(path.join(root, "nexshop-frontend", "reseller.js"), "utf8").replace(/\r\n/g, "\n");
const index = fs.readFileSync(path.join(root, "nexshop-frontend", "index.html"), "utf8").replace(/\r\n/g, "\n");
const script = fs.readFileSync(path.join(root, "nexshop-frontend", "script.js"), "utf8").replace(/\r\n/g, "\n");

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function mediaBlock(source, query) {
    const marker = `@media ${query}`;
    const start = source.indexOf(marker);
    assert(start >= 0, `missing media query ${marker}`);
    const open = source.indexOf("{", start);
    let depth = 0;
    for (let i = open; i < source.length; i += 1) {
        if (source[i] === "{") depth += 1;
        if (source[i] === "}") {
            depth -= 1;
            if (depth === 0) return source.slice(start, i + 1);
        }
    }
    throw new Error(`unterminated media query ${marker}`);
}

const mobile = mediaBlock(css, "(max-width: 767px)");
const walletCss = css.slice(css.indexOf("NEXSHOP WALLET & MOBILE DRAWER STYLES"));
const walletTablet = mediaBlock(walletCss, "(max-width: 1023px)");
const topupRule = selector => new RegExp(`${selector}\\s*\\{[\\s\\S]*?\\}`, "m");
const topupAt = (min, columns) => new RegExp(`@media\\s*\\(min-width:\\s*${min}px\\)\\s*\\{[\\s\\S]*?#topup \\.topup-game-grid\\s*\\{[\\s\\S]*?grid-template-columns:\\s*repeat\\(${columns},`, "m");
const mobileSection = /@media\\s*\\(max-width:\\s*767px\\)[\\s\\S]*$/m;

assert(/#topup \.topup-game-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4,/.test(css), "Top-Up Terpopuler must default to 4 columns");
assert(topupAt(768, 4).test(css), "tablet top-up grid must retain 4 columns");
assert(topupAt(1024, 5).test(css), "desktop top-up grid must use 5 columns");
assert(topupAt(1280, 6).test(css), "wide top-up grid must use 6 columns");

assert(/#mainNav\s+\.nx-nav-actions/.test(css), "navbar action scope must exist");
assert(/#mainNav\s+\.nx-nav-actions\s*>\s*button:not\(\.nx-wallet-nav-btn\)/.test(walletTablet), "tablet action sizing must exclude the wallet so its balance cannot overflow into the account button");
assert(/@media\s*\(max-width:\s*767px\)[\s\S]*?#mainNav\s+#accountBtn[\s\S]*?display:\s*flex/.test(css), "account avatar must remain independently visible below 768px");
assert(/@media\s*\(max-width:\s*767px\)[\s\S]*?#mainNav\s+\.nx-nav-actions\s*>\s*\.nx-wallet-nav-btn\s*\{[\s\S]*?min-width:\s*70px/.test(css), "mobile wallet must override the legacy 40px flex basis");
assert(/#mainNav\s+\.nx-nav-inner\s*\{[\s\S]*?padding-inline:\s*0/.test(css), "mobile navbar must not add a second horizontal padding layer");

assert(/@media\s*\(max-width:\s*767px\)[\s\S]*?\.topup-detail\s*\{[\s\S]*?width:\s*calc\(100%\s*\+\s*20px\)[\s\S]*?margin-inline:\s*-10px/.test(css), "mobile product detail must reclaim the page gutter");
assert(/@media\s*\(max-width:\s*767px\)[\s\S]*?\.topup-detail\s*\{[\s\S]*?padding:\s*16px/.test(css), "mobile product detail must use 16px page padding");
assert(/@media\s*\(max-width:\s*767px\)[\s\S]*?\.topup-detail[\s\S]*?\.tw-panels\s*\{[\s\S]*?(?:padding-inline:\s*12px|padding:\s*20px\s+12px)/.test(css), "mobile nominal panel must not waste horizontal space");
assert(/\.tw-product-group-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4,/.test(css), "nominal grid must stay 4 columns");
assert(/\.tw-product-group-grid\s*\{[\s\S]*?gap:\s*8px/.test(css), "nominal grid mobile gap must be 8px");
assert(/@media\s*\(max-width:\s*767px\)[\s\S]*?\.topup-detail\s+\.tw-product-group-grid\s*>\s*\.tw-product-card:only-child\s*\{[\s\S]*?grid-column:\s*span\s*1/.test(css), "mobile nominal singleton cards must stay one column wide");
assert(/\.tw-product-card h5[\s\S]*?-webkit-line-clamp:\s*3/.test(css), "nominal labels may use up to three readable lines");
assert(/body:has\(\#topupDetail:not\(\.hidden\)\)\s+\.nexbot-widget\s*\{[\s\S]*?display:\s*none/.test(css), "mobile product must not let NexBot cover nominal choices");

assert(!/\.rs-page \.rs-section-heading h2,\s*\n\.rs-page \.rs-api-copy h2,/.test(resellerCss), "PDF light-section selector must not override developer API heading");
assert(/\.rs-page \.rs-api-copy h2\s*\{[\s\S]*?color:\s*#fff/.test(resellerCss), "developer API heading must stay white on navy");
assert(/\.rs-api-copy > p:not\(\.rs-kicker\)\s*\{[\s\S]*?color:\s*#d8e1ec/.test(resellerCss), "developer API body text must use readable light color");
assert(/style\.css\?v=20260903-responsive-nav-account-5/.test(index), "homepage style cache-buster must be bumped");
assert(/script\.js\?v=20260903-ui-layout-4/.test(index), "wallet script cache-buster must be bumped");
assert(/id="walletViewGuest"/.test(index), "wallet modal must have a separate guest state");
assert(/id="btnWalletGuestLogin"/.test(index), "guest wallet state must offer a separate login action");
assert(/function openWalletModal\([\s\S]*?walletViewGuest/.test(script), "wallet click must control the wallet guest state");
assert(!/function openWalletModal\([\s\S]*?accBtn\.click\(\)/.test(script), "wallet click must never delegate to the account button");
assert(/const cardObserver\s*=\s*new IntersectionObserver/.test(resellerJs), "reseller cards need a dedicated in/out observer");
assert(/entry\.target\.classList\.toggle\("rs-is-visible", entry\.isIntersecting\)/.test(resellerJs), "reseller card visibility must follow viewport entry and exit");
assert(/cardObserver\.observe\(card\)/.test(resellerJs), "every reseller product card must be observed for repeated motion");
assert(/\.rs-showcase-card, \.rs-tier-card/.test(resellerJs), "reseller card observer must cover showcase and tier cards");

console.log("sim103_responsive_nav_catalog_layout: passed");
