"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const page = read("nexshop-frontend/reseller.html");
const css = read("nexshop-frontend/reseller.css");
const js = read("nexshop-frontend/reseller.js");

const tests = [
    ["scoped motion system exists", () => {
        assert.match(css, /rs-motion-ready/);
        assert.match(css, /rs-reveal/);
        assert.match(css, /rs-is-visible/);
        assert.match(js, /IntersectionObserver/);
        assert.match(js, /prefers-reduced-motion/);
    }],
    ["hero portal motion has performance-safe layers", () => {
        assert.match(css, /rs-portal-window[^{}]*|\.rs-portal-window/);
        assert.match(css, /rs-hero-window-in/);
        assert.match(css, /rs-network-pulse/);
        assert.match(css, /rs-hero-float/);
        assert.match(css, /rotateX|rotateY/);
        assert.match(js, /rs-hero-visual/);
        assert.match(js, /pointermove|rs-tilt-x/);
    }],
    ["sections expose stagger and interaction states", () => {
        assert.match(css, /rs-stagger/);
        assert.match(css, /rs-tier-card-featured.*rs-tier-badge|rs-tier-badge.*rs-tier-card-featured/);
        assert.match(css, /rs-steps-grid\.rs-steps-progress[\s\S]*?::after/);
        assert.match(css, /rs-steps-grid::before,\s*\n?\s*\.rs-steps-grid::after[\s\S]*?display:\s*none/);
        assert.match(css, /rs-code-sheen/);
        assert.match(css, /\.rs-button:hover\s+i|\.rs-text-link:hover\s+i/);
    }],
    ["FAQ remains semantic while supporting animated state", () => {
        assert.match(page, /aria-expanded="false"/);
        assert.match(page, /role="region"/);
        assert.match(page, /hidden/);
        assert.match(js, /rs-faq-panel/);
        assert.match(js, /transitionend|scrollHeight/);
    }],
    ["motion has reduced-motion and mobile fallbacks", () => {
        assert.match(css, /prefers-reduced-motion/);
        assert.match(css, /max-width:\s*640px/);
        assert.match(css, /rs-steps-grid\.rs-steps-progress[\s\S]*?::after/);
        assert.match(css, /rs-steps-grid::before,\s*\n?\s*\.rs-steps-grid::after[\s\S]*?display:\s*none/);
        assert.doesNotMatch(page, /gsap|framer-motion|lottie/i);
    }],
    ["copy, CTA destinations, and FAQ count remain intact", () => {
        for (const phrase of ["Bangun bisnis produk digital dengan harga reseller.", "Gratis bergabung, Tanpa minimum deposit.", "3×24 jam kerja", "Partner Portal", "Harga reseller otomatis"]) {
            assert.ok(page.includes(phrase), `missing copy: ${phrase}`);
        }
        assert.ok((page.match(/href="\/portal-reseller\?mode=register"/g) || []).length >= 2);
        assert.ok((page.match(/class="rs-faq-trigger"/g) || []).length === 5);
    }]
];

const failures = [];
for (const [name, fn] of tests) {
    try { fn(); } catch (error) { failures.push(`FAIL ${name}: ${error.message}`); }
}

if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
}
console.log(`PASS sim73: reseller motion contract (${tests.length} checks).`);
