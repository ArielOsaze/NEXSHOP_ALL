"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const controller = fs.readFileSync(path.join(root, "nexshop-backend", "controllers", "aiController.js"), "utf8");
const { isPriceQuestion } = require(path.join(root, "nexshop-backend", "utils", "nexbotCatalog"));

assert.strictEqual(isPriceQuestion("harga Genshin Impact berapa?"), true,
  "pertanyaan harga untuk nama produk dinamis harus dikenali sebagai kandidat katalog");
assert.match(controller, /const catalogProbeAllowed = inScope \|\| isPriceQuestion\(message\);/,
  "scope gate harus memberi kandidat harga kesempatan lookup katalog read-only");
assert.match(controller, /const resolvedScope = inScope \|\| Boolean\(priceReply\);/,
  "produk yang benar-benar ditemukan di katalog harus menjadi scope NexShop");
assert.match(controller, /if \(!resolvedScope\) \{\s*reply = OUT_OF_SCOPE_REPLY;/,
  "kandidat harga yang tidak ada di katalog harus tetap ditolak sebelum provider AI");

console.log("PASS sim61: produk katalog dinamis lolos scope NexBot tanpa membuka topik luar domain");
