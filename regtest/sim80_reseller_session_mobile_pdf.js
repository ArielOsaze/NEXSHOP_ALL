"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const portal = fs.readFileSync(path.join(root, "nexshop-frontend", "portal-reseller.html"), "utf8").replace(/\r\n/g, "\n");
const authSecurity = fs.readFileSync(path.join(root, "nexshop-frontend", "auth-security.js"), "utf8").replace(/\r\n/g, "\n");
const printCss = fs.readFileSync(path.join(root, "nexshop-frontend", "docs-reseller-print.css"), "utf8").replace(/\r\n/g, "\n");

function check(label, condition) {
    assert(condition, `FAIL ${label}`);
    console.log(`PASS ${label}`);
}

console.log("NEXSHOP REGTEST 80: PORTAL SESSION, MOBILE LOGIN TIMEOUT & PDF FLOW");

check("Portal session tidak membaca/menulis token dari localStorage", !/localStorage\.(getItem|setItem)\([\"']nexshop-reseller-(token|user)/.test(portal));
check("Portal session memakai storage tab", /sessionStorage\.(getItem|setItem|removeItem)\([\"']nexshop-reseller-(token|user)/.test(portal));
check("legacy token lama dibersihkan", /localStorage\.removeItem\([\"']nexshop-reseller-token[\"']\)/.test(portal));
check("auth security memiliki timeout request", /AbortController|AUTH_REQUEST_TIMEOUT_MS|timeoutId/.test(authSecurity));
check("submit login Portal memiliki timeout request", /PORTAL_AUTH_REQUEST_TIMEOUT_MS[\s\S]*portalFetchWithTimeout[\s\S]*AbortController/.test(portal));
check("captcha loader memiliki timeout fail-closed", /TURNSTILE_LOAD_TIMEOUT_MS|Gagal memuat verifikasi keamanan dalam batas waktu/.test(authSecurity));
check("PDF code block boleh wrap saat print", /\.docs-code-content[\s\S]*white-space:\s*pre-wrap/.test(printCss));
check("PDF code block tidak crop horizontal saat print", /\.docs-code-content[\s\S]*overflow:\s*visible\s*!important/.test(printCss));
check("PDF code block boleh terbelah antar halaman", /\.docs-code-block[\s\S]*break-inside:\s*auto/.test(printCss));

console.log("PASS sim80: session Portal, timeout login mobile, dan layout PDF print contract");
