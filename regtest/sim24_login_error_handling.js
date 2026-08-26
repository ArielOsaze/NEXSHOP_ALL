const assert = require("assert");
const fs = require("fs");
const source = fs.readFileSync(require.resolve("../nexshop-frontend/script.js"), "utf8").replace(/\r\n/g, "\n");
const start = source.indexOf('document.getElementById("loginForm").addEventListener("submit"');
const end = source.indexOf('function openPhoneOnboarding()', start);
assert.ok(start >= 0 && end > start, "login handler tidak ditemukan");
const handler = source.slice(start, end);

assert.match(handler, /let loginResponse;/);
assert.match(handler, /loginResponse = await fetch/);
assert.match(handler, /catch \(networkError\)/);
assert.match(handler, /Gagal terhubung ke server/);
assert.match(handler, /catch \(uiError\)/);
assert.doesNotMatch(handler, /catch \(err\) \{\n\s+errorEl\.textContent = "Gagal terhubung ke server\.";\n\s+\}/);

console.log("sim24_login_error_handling: passed");
