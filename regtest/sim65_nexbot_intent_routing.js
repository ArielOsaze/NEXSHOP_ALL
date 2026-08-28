"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const controller = fs.readFileSync(path.join(root, "nexshop-backend/controllers/aiController.js"), "utf8");
const catalog = fs.readFileSync(path.join(root, "nexshop-backend/utils/nexbotCatalog.js"), "utf8");

assert.match(controller, /function isRefundQuery\(message\)/,
    "pertanyaan salah ID/refund harus punya intent routing deterministik");
assert.match(controller, /isRefundQuery\(message\)/,
    "routing refund harus dipakai oleh answer flow");
assert.match(controller, /builtin-refund/,
    "routing refund harus menggunakan fakta kebijakan refund resmi");
assert.match(controller, /salah.*(?:memasukkan|masukin|input).*ID|ID.*salah/i,
    "fakta refund harus menjelaskan skenario ID salah");

assert.match(catalog, /game:\s*\[\]/,
    "fallback katalog harus tetap memiliki daftar game saat database gagal");
assert.match(catalog, /source_jenis_name/,
    "indeks katalog harus membaca nama game dari source_jenis_name");
assert.match(catalog, /type:\s*["']game["']/,
    "target katalog game harus dibedakan dari kategori marketplace");
assert.match(catalog, /type\s*===\s*["']game["'][\s\S]{0,180}source_jenis_name/,
    "fetch harga game harus query source_jenis_name");
assert.match(controller, /nexbotCatalog\.isPriceQuestion\(message\)/,
    "harga harus melalui catalog price handler, bukan provider generik");

console.log("PASS sim65: routing refund dan harga game dinamis NexBot terpisah dari fallback topup ML");
