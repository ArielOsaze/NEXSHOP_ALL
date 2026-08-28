"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const docs = fs.readFileSync(
    path.join(__dirname, "..", "nexshop-frontend", "docs-reseller.html"),
    "utf8"
);

const tocStart = docs.indexOf('<details class="docs-mobile-toc">');
const tocEnd = docs.indexOf("</details>", tocStart);
assert.ok(tocStart >= 0 && tocEnd > tocStart, "Mobile ToC harus tersedia");
const toc = docs.slice(tocStart, tocEnd);

assert.doesNotMatch(
    toc,
    /<li>\s*<a[^>]*>\s*\d+\s*\.\s*/i,
    "Mobile ToC tidak boleh menggandakan nomor dari marker ol"
);
assert.match(
    docs,
    /href=["']\/portal-reseller\?mode=register["'][^>]*>[\s\S]*?Daftar Reseller/i,
    "CTA Daftar Reseller harus menuju Portal Reseller dedicated"
);
assert.doesNotMatch(
    docs,
    /href=["']\/reseller#form-daftar["']/i,
    "docs tidak boleh memakai entry point reseller storefront yang stale"
);

console.log("PASS sim64: ToC reseller tidak duplikat dan CTA menuju Portal Reseller");
