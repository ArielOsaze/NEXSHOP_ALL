"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const ingest = fs.readFileSync(path.join(root, "nexshop-backend", "scripts", "ingest-website.js"), "utf8");

assert(ingest.includes("url: `${BASE_URL}/docs-reseller`") && ingest.includes("title: 'Dokumentasi Reseller NexShop'"),
  "web ingestion harus mencakup dokumentasi reseller resmi");
assert(ingest.includes("file: 'docs-reseller.html'") && ingest.includes("title: 'Dokumentasi Reseller NexShop'"),
  "local ingestion harus mencakup dokumentasi reseller resmi");
assert(ingest.includes("category: \"ResellerDocumentation\""),
  "chunk dokumentasi reseller harus dapat diberi kategori retrieval yang spesifik");

assert(ingest.includes('category === "ResellerDocumentation"') && ingest.includes('reseller portal kyc 2fa api key webhook'),
  "chunk docs reseller harus membawa keyword domain untuk retrieval lexical");

console.log("PASS sim60: sumber dokumentasi reseller masuk corpus NexBot");
