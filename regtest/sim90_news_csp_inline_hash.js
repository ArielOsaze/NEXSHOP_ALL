"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "nexshop-frontend", "berita-artikel.html"), "utf8").replace(/\r\n/g, "\n");
const nginx = fs.readFileSync(path.join(root, "nginx-nexshop.conf"), "utf8");
const headers = fs.readFileSync(path.join(root, "nexshop-frontend", "_headers"), "utf8");
const sha256 = value => `sha256-${crypto.createHash("sha256").update(value, "utf8").digest("base64")}`;
const scriptHashes = [...html.matchAll(/<script(?:([^>]*))>([\s\S]*?)<\/script>/g)]
    .filter(match => !/type\s*=\s*["']application\/ld\+json["']/i.test(match[1] || ""))
    .map(match => match[2])
    .filter(body => body.trim())
    .map(sha256);
const styleHashes = [...html.matchAll(/<style(?:[^>]*)>([\s\S]*?)<\/style>/g)]
    .map(match => match[1])
    .filter(body => body.trim())
    .map(sha256);
const nginxPolicy = (nginx.match(/add_header Content-Security-Policy "([^"]+)" always;/) || [])[1] || "";
const headersPolicy = (headers.match(/Content-Security-Policy:\s*(.+)/) || [])[1] || "";

for (const hash of scriptHashes) {
    assert(nginxPolicy.includes(`'${hash}'`), `Nginx CSP missing inline script hash ${hash}`);
    assert(headersPolicy.includes(`'${hash}'`), `_headers CSP missing inline script hash ${hash}`);
}
for (const hash of styleHashes) {
    assert(nginxPolicy.includes(`'${hash}'`), `Nginx CSP missing inline style hash ${hash}`);
    assert(headersPolicy.includes(`'${hash}'`), `_headers CSP missing inline style hash ${hash}`);
}
assert(!nginxPolicy.includes("unsafe-inline") && !headersPolicy.includes("unsafe-inline"), "News CSP must not use unsafe-inline");
console.log("PASS sim90: News inline script/style hashes are present in every CSP source");
