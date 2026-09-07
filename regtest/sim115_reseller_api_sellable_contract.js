"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(
    path.join(__dirname, "..", "nexshop-backend", "controllers", "resellerApiController.js"),
    "utf8"
);

assert.match(source, /filterSellablePortalProducts/, "direct order wajib memakai filter sellable katalog");
assert.match(source, /source_status/, "direct order wajib membaca status supplier untuk filter sellable");
assert.match(source, /is_active/, "direct order wajib mempertahankan guard produk aktif");
assert.match(source, /filterSellablePortalProducts\(\s*\[product\]\s*\)/, "produk yang ditemukan wajib divalidasi sebagai sellable sebelum debit");

console.log("PASS sim115_reseller_api_sellable_contract");
