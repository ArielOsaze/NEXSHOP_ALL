"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = path.join(__dirname, "..");
const controller = fs.readFileSync(path.join(root, "nexshop-backend", "controllers", "resellerController.js"), "utf8");
const routes = fs.readFileSync(path.join(root, "nexshop-backend", "routes", "resellerRoutes.js"), "utf8");
const middleware = fs.readFileSync(path.join(root, "nexshop-backend", "middleware", "resellerPortalAuthMiddleware.js"), "utf8");
const twoFactorService = fs.readFileSync(path.join(root, "nexshop-backend", "services", "resellerTwoFactorService.js"), "utf8");
const portal = fs.readFileSync(path.join(root, "nexshop-frontend", "portal-reseller.html"), "utf8");
const migrationPath = path.join(root, "nexshop-backend", "migrations", "024_create_reseller_portal_2fa.sql");

function check(label, condition) {
    if (!condition) throw new Error(`FAIL ${label}`);
    console.log(`PASS ${label}`);
}

check("migration 024 tersedia", fs.existsSync(migrationPath));
const migration = fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, "utf8") : "";
check("2FA menyimpan secret terenkripsi dan tidak plaintext", /secret_ciphertext/i.test(migration) && /recovery_codes_hashes/i.test(migration) && !/secret\s+text\b/i.test(migration));
check("2FA default nonaktif", /enabled\s+BOOLEAN\s+NOT NULL\s+DEFAULT\s+FALSE/i.test(migration));
check("controller menyediakan setup, enable, disable, dan verify", ["setupResellerTwoFactor", "enableResellerTwoFactor", "disableResellerTwoFactor", "verifyResellerTwoFactor"].every(name => controller.includes(name)));
check("login mengeluarkan challenge tanpa access token saat 2FA aktif", /two_factor_required/i.test(controller) && /PORTAL_2FA_REQUIRED/i.test(controller) && /portal_2fa_challenge/i.test(controller));
check("TOTP diverifikasi server-side dengan HMAC", /createHmac\([\"']sha1[\"']/i.test(twoFactorService) && /timingSafeEqual/i.test(twoFactorService));
check("recovery code di-hash dan sekali pakai", /recovery_codes_hashes/i.test(controller) && /bcrypt\.compare/i.test(controller) && /filter\(/i.test(controller));
check("JWT portal hasil verifikasi membawa faktor 2FA", /two_factor_verified\s*:/i.test(controller) && /createPortalAccessToken\(user, portalAccount, true\)/i.test(controller));
check("middleware menolak token lama setelah 2FA diaktifkan", /two_factor_verified/i.test(middleware) && /PORTAL_2FA_REQUIRED/i.test(middleware));
check("route 2FA terpasang", ["/auth/2fa/verify", "/portal/2fa/setup", "/portal/2fa/enable", "/portal/2fa/disable"].every(route => routes.includes(route)));
check("UI portal punya setup dan challenge 2FA", ["twoFactorCode", "btnTwoFactorSetup", "formTwoFactorVerify", "PORTAL_2FA_REQUIRED"].every(marker => portal.includes(marker)));

process.env.PORTAL_2FA_ENCRYPTION_KEY = "sim55-test-key-not-a-production-secret";
const runtime = require(path.join(root, "nexshop-backend", "services", "resellerTwoFactorService.js"));
const runtimeSecret = runtime.generateTotpSecret();
const encrypted = runtime.encryptSecret(runtimeSecret);
check("AES-GCM secret dapat didekripsi kembali", runtime.decryptSecret(encrypted) === runtimeSecret);
const runtimeCode = runtime.generateTotpCode(runtimeSecret, 1700000000000);
check("TOTP valid diterima dan kode salah ditolak", runtime.verifyTotp(runtimeSecret, runtimeCode, 1700000000000) && !runtime.verifyTotp(runtimeSecret, "000000", 1700000000000));

const csp = fs.readFileSync(path.join(root, "nginx-nexshop.conf"), "utf8");
const inline = [...portal.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(m => !/\bsrc\s*=/i.test(m[1]) && m[2].trim())
    .map(m => "'sha256-" + crypto.createHash("sha256").update(m[2], "utf8").digest("base64") + "'");
check("CSP mencakup inline script portal terbaru", inline.every(hash => csp.includes(hash)));

console.log("PASS sim55: optional Portal Reseller 2FA contract");
