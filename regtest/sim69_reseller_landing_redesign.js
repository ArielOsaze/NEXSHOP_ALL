"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const page = read("nexshop-frontend/reseller.html");
const css = read("nexshop-frontend/reseller.css");
const js = read("nexshop-frontend/reseller.js");

const tests = [];
function test(name, fn) {
    try {
        fn();
        tests.push({ name, ok: true });
    } catch (error) {
        tests.push({ name, ok: false, error });
    }
}

const count = (value, pattern) => (value.match(pattern) || []).length;

// Page structure and safe adaptation of the Stitch reference.
test("reseller page uses one h1 and the dedicated local stylesheet/script", () => {
    assert.strictEqual(count(page, /<h1\b/gi), 1);
    assert.match(page, /href="\/reseller\.css\?v=20260829-reseller-motion-1"/);
    assert.match(page, /src="\/reseller\.js\?v=20260829-reseller-motion-1"/);
    assert.doesNotMatch(page, /cdn\.tailwindcss\.com|@url:`|aida-public|aida\/AEtj/);
    assert.doesNotMatch(page, /<style\b/i);
});

test("reseller navigation exposes full anchors and an accessible mobile menu", () => {
    for (const id of ["benefits", "tiers", "how-it-works", "api-preview", "faq"]) {
        assert.match(page, new RegExp(`href="#${id}"`));
        assert.match(page, new RegExp(`id="${id}"`));
    }
    assert.match(page, /id="resellerNavToggle"[^>]*aria-expanded="false"[^>]*aria-controls="resellerNavMenu"/);
    assert.match(page, /id="resellerNavMenu"/);
    assert.match(css, /@media\s*\(max-width:\s*\d+px\)/);
    assert.match(js, /resellerNavToggle/);
    assert.match(js, /aria-expanded/);
});

test("all reseller CTAs retain existing destinations", () => {
    assert.ok(count(page, /href="\/portal-reseller\?mode=register"/g) >= 2);
    assert.ok(count(page, /href="\/portal-reseller\?mode=login"/g) >= 2);
    assert.ok(count(page, /href="\/docs-reseller"/g) >= 1);
});

test("FAQ controls are keyboard-accessible and wired to panels", () => {
    const triggers = page.match(/class="[^"]*rs-faq-trigger[^"]*"[^>]*aria-expanded="false"[^>]*aria-controls="[^"]+"/g) || [];
    assert.ok(triggers.length >= 4);
    assert.match(page, /role="region"/);
    assert.match(js, /rs-faq-trigger/);
    assert.match(js, /setAttribute\("aria-expanded"/);
});

test("required reseller business content remains machine-readable", () => {
    for (const phrase of [
        "top up game", "e-wallet", "pulsa", "paket data", "PLN", "voucher", "tagihan",
        "Gratis bergabung", "Tanpa minimum deposit", "3×24 jam kerja", "Harga reseller otomatis",
        "API Key", "Secret Key", "IP Whitelist", "Webhook Relay", "Partner Portal terpisah",
        "Silver", "2% off", "Gold", "3,5% off", "Platinum", "hingga 5% off",
        "Potongan menyesuaikan margin masing-masing produk", "KYC", "Dikembangkan oleh Ariel"
    ]) {
        assert.ok(page.includes(phrase), `missing required phrase: ${phrase}`);
    }
});

test("page keeps production safety boundaries and progressive image behavior", () => {
    assert.match(page, /cookie-consent\.js/);
    assert.match(page, /legal-modal\.js/);
    assert.match(page, /nexbot\.js/);
    assert.match(page, /loading="lazy"/);
    assert.doesNotMatch(page, /<form\b/i);
    assert.doesNotMatch(page, /api[_ -]?key\s*[:=]\s*["'][^<{]+/i);
});

test("responsive CSS protects overflow, touch targets, reduced motion, and code preview", () => {
    assert.match(css, /overflow-x:\s*hidden/);
    assert.match(css, /min-height:\s*44px/);
    assert.match(css, /prefers-reduced-motion/);
    assert.match(css, /overflow-x:\s*auto/);
    assert.match(css, /grid-template-columns/);
});

const failures = tests.filter((item) => !item.ok);
if (failures.length) {
    for (const failure of failures) {
        console.error(`FAIL ${failure.name}: ${failure.error.message}`);
    }
    process.exitCode = 1;
} else {
    console.log(`PASS sim69: reseller landing redesign contract (${tests.length} checks).`);
}
