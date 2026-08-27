"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const dashboard = fs.readFileSync(path.join(root, "nexshop-frontend/admin/dashboard.html"), "utf8");
const home = fs.readFileSync(path.join(root, "nexshop-frontend/index.html"), "utf8");
const manifest = fs.readFileSync(path.join(root, "nexshop-frontend/manifest.json"), "utf8");

assert.match(
    dashboard,
    /dashboard\.js\?v=20260827-(?!logout-modal)[A-Za-z0-9_-]+/,
    "dashboard.js harus memiliki cache-buster setelah perubahan endpoint action"
);
assert.doesNotMatch(dashboard, /dashboard\.js\?v=20260827-logout-modal/);
assert.match(
    home,
    /<link rel="icon"[^>]+href="\/favicon\.ico\?v=[^"]+"/,
    "favicon homepage harus memakai URL berversi agar Google mengambil asset baru"
);
assert.match(manifest, /nexshop-logo-192\.png\?v=/);
assert.match(manifest, /nexshop-logo-512\.png\?v=/);

console.log("sim41_cache_busters: passed");
