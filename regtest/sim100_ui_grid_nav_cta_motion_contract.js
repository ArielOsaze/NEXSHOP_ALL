"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const style = read("nexshop-frontend/style.css");
const resellerCss = read("nexshop-frontend/reseller.css");
const resellerJs = read("nexshop-frontend/reseller.js");
const frontend = read("nexshop-frontend/script.js");
const index = read("nexshop-frontend/index.html");

const mustMatch = (source, pattern, message) => assert.match(source, pattern, message);

// Outer catalog stays readable. Dense four-column layout belongs only to nominal tiles.
mustMatch(style, /#topup\s+\.topup-game-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s,
    "outer Top-Up Terpopuler grid must start at two columns on mobile");
mustMatch(style, /@media\s*\(min-width:\s*768px\)[\s\S]*?#topup\s+\.topup-game-grid\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/,
    "outer grid must use four columns on tablet");
mustMatch(style, /@media\s*\(min-width:\s*1024px\)[\s\S]*?#topup\s+\.topup-game-grid\s*\{[^}]*grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/,
    "outer grid must use five columns on desktop");
mustMatch(style, /@media\s*\(min-width:\s*1280px\)[\s\S]*?#topup\s+\.topup-game-grid\s*\{[^}]*grid-template-columns:\s*repeat\(6,\s*minmax\(0,\s*1fr\)\)/,
    "outer grid must use six columns on wide desktop");

mustMatch(style, /\.tw-product-group-grid\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)[^}]*gap:\s*8px/s,
    "nominal grid must use a compact four-column mobile layout");
mustMatch(style, /@media\s*\(min-width:\s*768px\)[\s\S]*?\.tw-product-group-grid\s*\{[^}]*grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)/,
    "nominal grid must use five columns on tablet");
mustMatch(style, /@media\s*\(min-width:\s*1280px\)[\s\S]*?\.tw-product-group-grid\s*\{[^}]*grid-template-columns:\s*repeat\(6,\s*minmax\(0,\s*1fr\)/,
    "nominal grid must use six columns on wide desktop");

mustMatch(style, /@media\s*\(max-width:\s*480px\)[\s\S]*?\.nx-brand-name\s*\{[^}]*display:\s*none/s,
    "mobile navbar must hide wordmark below 480px");
mustMatch(style, /@media\s*\(max-width:\s*480px\)[\s\S]*?\.nx-nav-actions\s*\{[^}]*overflow:\s*visible/s,
    "mobile navbar actions must not become a horizontal scroll rail");
mustMatch(style, /@media\s*\(max-width:\s*360px\)[\s\S]*?\.nx-wallet-nav-info\s*\{[^}]*display:\s*none/s,
    "very narrow navbar must use an icon-only wallet");

const finalOverride = resellerCss.slice(resellerCss.lastIndexOf(".rs-page .rs-final-cta h2"));
mustMatch(finalOverride, /\.rs-page\s+\.rs-final-cta\s+h2\s*\{[^}]*color:\s*#fff[^}]*-webkit-text-fill-color:\s*#fff/s,
    "final CTA heading must explicitly win over PDF heading color");
mustMatch(resellerJs, /const initShowcaseCardTilt\s*=\s*\(\)\s*=>/, "showcase cards need fine-pointer spotlight/tilt initialization");
mustMatch(resellerJs, /initShowcaseCardTilt\(\);/, "showcase card motion must be initialized");
mustMatch(resellerCss, /@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)[\s\S]*?\.rs-showcase-card/s,
    "showcase tilt must be capability-scoped to fine pointers");
mustMatch(resellerCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.rs-showcase-card/,
    "showcase motion must provide a reduced-motion path");
mustMatch(resellerJs, /const registerViewportSync\s*=\s*\(sync\)\s*=>/, "motion must have a rAF-coalesced scroll/resize fallback when observer delivery is delayed");
mustMatch(resellerJs, /document\.hidden\s*\?\s*queueMicrotask/, "hidden tabs must settle viewport state without waiting for a throttled animation frame");
mustMatch(resellerJs, /registerViewportSync\(\(\)\s*=>[\s\S]*?\.rs-reveal/, "reveal cards must be visible through the fallback when they enter the viewport");
mustMatch(resellerJs, /registerViewportSync\(syncStories\)/, "showcase stories must start and stop through the same viewport fallback");
mustMatch(resellerJs, /registerViewportSync\(syncCta\)/, "final CTA background motion must follow actual viewport visibility");

// Preserve the dynamic route and checkout data handoff while changing only visual rules.
mustMatch(frontend, /await\s+openGameDetail\(data\.name,[\s\S]*?products:\s*data\.products/s,
    "dynamic topup slug route must continue passing API products into checkout");
mustMatch(index, /id="topupGameGrid"/, "outer catalog selector must remain stable");

console.log("sim100_ui_grid_nav_cta_motion_contract: passed");
