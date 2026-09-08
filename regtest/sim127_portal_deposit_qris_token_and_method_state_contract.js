"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "nexshop-frontend", "portal-reseller.html"), "utf8");
const css = fs.readFileSync(path.join(root, "nexshop-frontend", "portal-reseller.css"), "utf8");
const cspHandlers = fs.readFileSync(path.join(root, "nexshop-frontend", "csp-legacy-handlers.js"), "utf8");
const ipaymu = fs.readFileSync(path.join(root, "nexshop-backend", "config", "ipaymu.js"), "utf8");

assert.strictEqual((html.match(/data-deposit-method=/g) || []).length, 3, "tiga kartu metode deposit harus punya identitas metode");
assert(html.includes('data-deposit-method="qris" aria-pressed="true"'), "QRIS harus menjadi pilihan awal yang terlihat terpilih");
assert(html.includes('id="resellerQrisToken"'), "Portal harus menyediakan fallback token QRIS yang terlihat");
assert(html.includes('id="resellerQrisTokenValue"'), "nilai token QRIS harus punya node aman untuk textContent");
assert(html.includes("const qrToken = String(data.qr_content || data.payment_no || (imageSource ? \"\" : data.qr_image || \"\"));"), "token QRIS harus dipakai saat qr_image bukan URL");
assert(html.includes("const qrUrl = imageSource;"), "frontend harus memakai image QR yang sudah dinormalisasi backend");
assert(ipaymu.includes('require("qrcode")'), "backend harus memiliki renderer QR lokal");
assert(ipaymu.includes("QRCode.toDataURL"), "token QRIS harus dirender menjadi data URL lokal");
assert(html.includes("function selectPaymentMethod(method, triggerEvent)"), "handler payment harus menerima event eksplisit");
assert(html.includes("classList.toggle(\"is-selected\""), "state selected harus berupa class yang dapat diuji");
assert(cspHandlers.includes("selectPaymentMethod('qris', event)"), "handler CSP QRIS harus meneruskan event");
assert(cspHandlers.includes("selectPaymentMethod('bca', event)"), "handler CSP BCA harus meneruskan event");
assert(cspHandlers.includes("selectPaymentMethod('mandiri', event)"), "handler CSP Mandiri harus meneruskan event");
assert(css.includes(".rs-portal-page .tv-deposit-method-option.is-selected"), "metode aktif harus memiliki outline scoped");
assert(css.includes("box-shadow: 0 0 0 3px"), "outline selected harus terlihat jelas di luar border");
assert(ipaymu.includes("const rawQrImage ="), "gateway QR harus menormalisasi field gambar provider");
assert(ipaymu.includes("const qrContent = rawQrContent || (qrImage ? null : rawQrImage);"), "QrTemplate token mentah harus menjadi qr_content, bukan qr_image");
console.log("PASS sim127_portal_deposit_qris_token_and_method_state_contract");
