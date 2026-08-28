"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const controller = fs.readFileSync(path.join(root, "nexshop-backend", "controllers", "aiController.js"), "utf8");
const { isPriceQuestion } = require(path.join(root, "nexshop-backend", "utils", "nexbotCatalog"));

assert.strictEqual(isPriceQuestion("harga Genshin Impact berapa?"), true,
  "pertanyaan harga untuk nama produk dinamis harus dikenali sebagai kandidat katalog");
assert.match(controller, /const preRagPriceReply = \(!preRagScope && isPriceQuestion\(message\)\)/,
  "harga produk dinamis boleh memakai catalog probe sebelum RAG");
assert.match(controller, /const scopeEstablished = preRagScope \|\| Boolean\(preRagPriceReply\);/,
  "produk yang benar-benar ditemukan di katalog harus menjadi scope NexShop");
assert.match(controller, /if \(!scopeEstablished\) \{\s*const reply = formatProfessionalReply\(OUT_OF_SCOPE_REPLY\);/,
  "kandidat harga yang tidak ada di katalog harus return out-of-scope sebelum RAG/provider");

console.log("PASS sim61: produk katalog dinamis lolos scope NexBot tanpa membuka topik luar domain");
