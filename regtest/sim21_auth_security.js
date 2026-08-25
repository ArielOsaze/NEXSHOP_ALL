"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const axios = require(path.join(__dirname, "..", "nexshop-backend", "node_modules", "axios"));
const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const turnstile = require(path.join(root, "nexshop-backend", "services", "turnstileService"));

let passed = 0;
function check(label, condition) {
    if (!condition) {
        console.error(`  [FAIL] ${label}`);
        process.exitCode = 1;
        return;
    }
    passed += 1;
    console.log(`  [PASS] ${label}`);
}

(async () => {
    console.log("NEXSHOP REGTEST 21: AUTH SECURITY\n");

    const authController = read("nexshop-backend/controllers/authController.js");
    const resellerController = read("nexshop-backend/controllers/resellerController.js");
    const routes = read("nexshop-backend/routes/authRoutes.js");
    const index = read("nexshop-frontend/index.html");
    const authUi = read("nexshop-frontend/auth-security.js");
    const adminLogin = read("nexshop-frontend/admin/login.html");
    const adminLoginUi = read("nexshop-frontend/admin/js/login.js");
    const nginx = read("nginx-nexshop.conf");

    check(
        "login dan registrasi utama memverifikasi Turnstile di server",
        authController.includes("requireHumanVerification(req, res)") &&
        authController.includes("verifyTurnstile(req.body?.captcha_token, req.ip)")
    );
    check(
        "login dan registrasi reseller juga memakai verifikasi server-side",
        resellerController.includes("requireResellerHumanVerification(req, res)") &&
        resellerController.includes("verifyTurnstile(req.body?.captcha_token, req.ip)")
    );
    check(
        "endpoint OAuth memakai callback dan exchange code satu kali tanpa JWT di URL",
        routes.includes('router.get("/google/callback"') &&
        routes.includes('router.post("/google/exchange"') &&
        authController.includes("createGoogleExchangeCode") &&
        authController.includes("googleExchangeCodes.delete(code)")
    );
    check(
        "akun dengan email lama wajib link eksplisit, bukan dibuat duplikat",
        authController.includes('error: "account_link_required"') &&
        authController.includes("linkGoogleUser") &&
        authController.includes("link_email_mismatch")
    );
    check(
        "browser hanya menerima site key Turnstile dan memuat challenge resmi",
        authUi.includes("turnstile_site_key") &&
        authUi.includes("challenges.cloudflare.com/turnstile") &&
        !authUi.includes("TURNSTILE_SECRET_KEY") &&
        index.includes('id="googleLoginBtn"') &&
        index.includes('id="googleRegisterBtn"')
    );
    check(
        "admin bisa bootstrap konfigurasi captcha, lalu tetap memakai challenge setelah aktif",
        authController.includes("allowAdminBootstrap") &&
        authController.includes("const isSuperAdminUser") &&
        adminLogin.includes('id="adminLoginTurnstile"') &&
        adminLoginUi.includes('captchaToken("admin-login", { allowUnconfigured: true })')
    );
    check(
        "CSP mengizinkan iframe dan script Turnstile secara terbatas",
        nginx.includes("https://challenges.cloudflare.com") &&
        nginx.includes("frame-src https://challenges.cloudflare.com")
    );

    const oldEnv = {
        secret: process.env.TURNSTILE_SECRET_KEY,
        sites: process.env.TURNSTILE_SITE_KEY,
        hosts: process.env.TURNSTILE_ALLOWED_HOSTNAMES
    };
    const originalPost = axios.post;
    process.env.TURNSTILE_SECRET_KEY = "test-secret";
    process.env.TURNSTILE_SITE_KEY = "test-site";
    process.env.TURNSTILE_ALLOWED_HOSTNAMES = "nexshop.cloud";
    try {
        axios.post = async () => ({ data: { success: true, hostname: "nexshop.cloud" } });
        check("hasil Turnstile valid dengan hostname yang diizinkan diterima", (await turnstile.verifyTurnstile("token", "203.0.113.2")).ok);
        axios.post = async () => ({ data: { success: true, hostname: "evil.example" } });
        check("hostname Turnstile yang tidak diizinkan ditolak", !(await turnstile.verifyTurnstile("token", "203.0.113.2")).ok);
        axios.post = async () => { throw new Error("network down"); };
        check("gangguan jaringan Turnstile gagal tertutup", !(await turnstile.verifyTurnstile("token", "203.0.113.2")).ok);
    } finally {
        axios.post = originalPost;
        if (oldEnv.secret === undefined) delete process.env.TURNSTILE_SECRET_KEY;
        else process.env.TURNSTILE_SECRET_KEY = oldEnv.secret;
        if (oldEnv.sites === undefined) delete process.env.TURNSTILE_SITE_KEY;
        else process.env.TURNSTILE_SITE_KEY = oldEnv.sites;
        if (oldEnv.hosts === undefined) delete process.env.TURNSTILE_ALLOWED_HOSTNAMES;
        else process.env.TURNSTILE_ALLOWED_HOSTNAMES = oldEnv.hosts;
    }

    if (!process.exitCode) console.log(`\nRINGKASAN: ${passed} pengujian lolos.`);
})().catch((error) => {
    console.error("FAIL:", error);
    process.exitCode = 1;
});
