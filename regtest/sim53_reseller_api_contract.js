"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const apiController = fs.readFileSync(path.join(root, "nexshop-backend/controllers/resellerApiController.js"), "utf8");
const apigames = require(path.join(root, "nexshop-backend/config/apigames"));
const tokovoucher = fs.readFileSync(path.join(root, "nexshop-backend/config/tokovoucher.js"), "utf8");
const dashboard = fs.readFileSync(path.join(root, "nexshop-frontend/admin/dashboard.html"), "utf8");
const docs = fs.readFileSync(path.join(root, "nexshop-frontend/docs-reseller.html"), "utf8");

assert.match(apiController, /require\("\.\.\/config\/apigames"\)/,
    "reseller nickname API must use the ApiGames adapter");
assert.doesNotMatch(apiController, /const \{ checkNickname \} = require\("\.\.\/utils\/topupHelpers"\)/,
    "reseller nickname API must not import a missing helper");
assert.match(apiController, /apigames\.checkNickname\(\{\s*kategori[,:]/s,
    "reseller nickname API must pass the documented object contract");
assert.match(apiController, /is_valid|available/,
    "reseller nickname API must map the adapter response contract");
assert.strictEqual(apigames.resolveGameCode("mobile-legends"), "mobilelegend",
    "documented mobile-legends code must resolve to ApiGames mobilelegend");
assert.strictEqual(apigames.resolveGameCode("free-fire"), "freefire",
    "documented free-fire code must resolve to ApiGames freefire");
assert.match(tokovoucher, /api\.post\(`\/v1\/transaksi\/status`/,
    "TokoVoucher status polling must use the documented POST endpoint");
assert.doesNotMatch(tokovoucher, /api\.get\(`\/v1\/transaksi\/status`/,
    "TokoVoucher status polling must not use GET on the POST-only endpoint");

assert.doesNotMatch(dashboard, /Game &amp; Gamepass|Game & Gamepass|Orders Game/,
    "admin topup UI must use the neutral Produk Topup naming");
assert.match(docs, /POST \/api\/v1\/reseller\/check-nickname/,
    "reseller docs must keep the live check-nickname endpoint");
assert.match(docs, /kode_game.*mobile-legends/s,
    "reseller docs must show the supported game code contract");
for (const code of ["UNSUPPORTED_GAME", "INVALID_GAME_ACCOUNT", "NICKNAME_PROVIDER_UNAVAILABLE"]) {
    assert.ok(docs.includes(code), `reseller docs must document ${code}`);
}

console.log("PASS sim53: reseller nickname flow and Produk Topup naming contract");
