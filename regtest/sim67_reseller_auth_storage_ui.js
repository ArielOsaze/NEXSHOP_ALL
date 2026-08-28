"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const portal = fs.readFileSync(path.join(root, "nexshop-frontend", "portal-reseller.html"), "utf8").replace(/\r\n/g, "\n");
const upload = fs.readFileSync(path.join(root, "nexshop-backend", "controllers", "uploadController.js"), "utf8").replace(/\r\n/g, "\n");
const reseller = fs.readFileSync(path.join(root, "nexshop-backend", "controllers", "resellerController.js"), "utf8").replace(/\r\n/g, "\n");

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

console.log("NEXSHOP REGTEST 67: RESELLER AUTH, KYC STORAGE & RESPONSIVE FORM");

const registerGridCount = (portal.match(/class=\"tv-register-grid\"/g) || []).length;
assert(registerGridCount === 4, "empat kelompok field register harus memakai class tv-register-grid");
assert(!/class=\"tv-auth-tabs\"[^>]*style=/.test(portal), "tab auth tidak boleh dikunci inline sebagai flex pada viewport sempit");
assert(portal.includes(".tv-auth-card {"), "auth card harus punya style terpusat");
assert(portal.includes("container-type: inline-size"), "auth card harus memakai container query berdasarkan lebar card");
assert(portal.includes("@container (max-width: 560px)"), "form harus punya breakpoint berbasis lebar card");
assert(portal.includes(".tv-auth-tabs { grid-template-columns: 1fr; }") || portal.includes(".tv-auth-tabs{grid-template-columns:1fr"), "tab auth harus menumpuk saat card sempit");
assert(portal.includes(".tv-register-grid { grid-template-columns: 1fr; }") || portal.includes(".tv-register-grid{grid-template-columns:1fr"), "field register harus satu kolom saat card sempit");
assert(portal.includes("class=\"tv-auth-error-message\""), "pesan error auth harus punya style class yang konsisten");

assert(upload.includes('const KYC_BUCKET = process.env.SUPABASE_KYC_BUCKET || "kyc-documents";'), "jalur KYC harus memakai bucket privat dedicated");
assert(upload.includes('code: kunciErr.code'), "error key KYC harus mengembalikan kode diagnostik aman");
assert(reseller.includes('const { data: portalAccount, error: portalErr } = await supabase'), "login harus membaca dedicated portal account");
assert(reseller.includes('code: "PORTAL_2FA_REQUIRED"'), "login harus mempertahankan challenge 2FA server-side");

console.log("PASS sim67: storage diagnosis dan responsive auth contract terkunci.");
