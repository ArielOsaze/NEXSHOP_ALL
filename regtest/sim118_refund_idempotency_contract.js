"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const walletService = fs.readFileSync(path.join(root, "nexshop-backend", "services", "walletService.js"), "utf8");
const topup = fs.readFileSync(path.join(root, "nexshop-backend", "controllers", "topupController.js"), "utf8");
const wallet = fs.readFileSync(path.join(root, "nexshop-backend", "controllers", "walletController.js"), "utf8");

assert.match(walletService, /refundRefId = refundReferenceId \|\| `REFUND-\$\{originalOrderId\}`/i);
assert.doesNotMatch(topup, /RF-TV0-\$\{order\.id\}-\$\{Date\.now\(\)\}/);
assert.doesNotMatch(wallet, /RF-ADM-\$\{order\.id\}-\$\{Date\.now\(\)\}/);
assert.match(topup, /refundMarkError/);
assert.match(topup, /\.is\("refunded_at", null\)/);
assert.match(wallet, /refundMarkError/);
assert.match(wallet, /\.is\("refunded_at", null\)/);

console.log("PASS sim118_refund_idempotency_contract");
