"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const wallet = fs.readFileSync(path.join(root, "nexshop-backend", "controllers", "walletController.js"), "utf8");
const ipaymu = fs.readFileSync(path.join(root, "nexshop-backend", "config", "ipaymu.js"), "utf8");
const portal = fs.readFileSync(path.join(root, "nexshop-frontend", "portal-reseller.html"), "utf8");
const css = fs.readFileSync(path.join(root, "nexshop-frontend", "portal-reseller.css"), "utf8");

assert.match(wallet, /bca:\s*\{\s*method:\s*"va",\s*channel:\s*"bca"\s*\}/);
assert.match(wallet, /mandiri:\s*\{\s*method:\s*"va",\s*channel:\s*"mandiri"\s*\}/);
assert.match(wallet, /paymentChannel:\s*resolvedPaymentChannel/);
assert.match(wallet, /payment_channel:\s*resolvedPaymentChannel/);
assert.match(wallet, /if \(paymentMethod === "bca" \|\| paymentMethod === "mandiri"\)/);

assert.match(ipaymu, /PaymentNo.*paymentNo.*VaNumber.*VirtualAccount.*PaymentCode/);
assert.match(ipaymu, /paymentName:.*PaymentName.*BankName/);
assert.match(ipaymu, /Provider tidak mengembalikan nomor Virtual Account/);

assert.match(portal, /id="depositVaCard"[^>]*hidden/);
assert.match(portal, /selectedDepositMethod !== "qris" && paymentNo/);
assert.match(portal, /id="resellerVaNumber"/);
assert.match(portal, /id="resellerVaExpiry"/);
assert.match(portal, /portal-deposit-va-number/);
assert.match(css, /portal-deposit-va-card/);
assert.match(css, /portal-deposit-va-number/);

console.log("PASS sim128_portal_deposit_va_channel_contract");