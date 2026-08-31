"use strict";

const assert = require("assert");
const crypto = require("crypto");
const https = require("https");

const url = "https://nexshop.cloud/portal-reseller?csp-contract=1";

function fetch(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { "cache-control": "no-cache" } }, (res) => {
            let body = "";
            res.setEncoding("utf8");
            res.on("data", (chunk) => { body += chunk; });
            res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
        }).on("error", reject);
    });
}

function inlineHashes(html, tag) {
    const pattern = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}>`, "gi");
    return [...html.matchAll(pattern)]
        .filter((m) => !/\bsrc\s*=|\bhref\s*=/i.test(m[1]) && !/application\/ld\+json/i.test(m[1]) && m[2].trim())
        .map((m) => `'sha256-${crypto.createHash("sha256").update(m[2].replace(/\r\n/g, "\n"), "utf8").digest("base64")}'`);
}

(async () => {
    const response = await fetch(url);
    assert.strictEqual(response.status, 200, `portal production harus HTTP 200, dapat ${response.status}`);
    const csp = response.headers["content-security-policy"] || "";
    assert(csp, "portal production harus mengirim Content-Security-Policy");
    const hashes = [...inlineHashes(response.body, "script"), ...inlineHashes(response.body, "style")];
    assert(hashes.length > 0, "portal production harus memiliki inline hash yang diaudit");
    assert(hashes.every((hash) => csp.includes(hash)), "RED: hash inline Portal production harus dikutip dan cocok dengan HTML tersaji");
    console.log("PASS qa_portal_live_csp_contract: inline hash Portal production valid dan terkutip");
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
