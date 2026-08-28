"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(
    path.join(root, "nexshop-backend", "scripts", "ingest-website.js"),
    "utf8"
);

assert(source.includes(".eq('title', chunk.title)") && source.includes(".update(chunk).eq('id', existingByTitle.id)"),
    "ingestion harus memperbarui knowledge berdasarkan title saat title lama tersedia");
assert(!source.includes('onConflict: "content_hash"'),
    "content_hash tidak boleh menjadi satu-satunya conflict key karena title juga unik");

console.log("PASS sim62: ingestion mengatasi constraint judul unik tanpa meninggalkan knowledge basi");
