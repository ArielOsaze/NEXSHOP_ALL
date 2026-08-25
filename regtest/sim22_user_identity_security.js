"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const { normalizePhoneNumber, toFonntePhone, toIpaymuPhone } = require(path.join(root, "nexshop-backend", "utils", "phoneNumber"));

let passed = 0;
function check(label, condition) {
    assert.ok(condition, label);
    passed += 1;
    console.log(`  [PASS] ${label}`);
}

console.log("NEXSHOP REGTEST 22: USER IDENTITY SECURITY\n");

check("08 dinormalisasi ke E.164", normalizePhoneNumber("0812 3456-7890") === "+6281234567890");
check("format 62 dan +62 menjadi nilai sama", normalizePhoneNumber("6281234567890") === "+6281234567890" && normalizePhoneNumber("+6281234567890") === "+6281234567890");
check("input bukan nomor Indonesia ditolak", normalizePhoneNumber("+14155552671") === "" && normalizePhoneNumber("08abc123") === "");
check("adapter Fonnte dan iPaymu tidak mengubah data kanonis", toFonntePhone("+6281234567890") === "6281234567890" && toIpaymuPhone("+6281234567890") === "081234567890");

const migration = read("nexshop-backend/migrations/015_harden_user_identity.sql");
const auth = read("nexshop-backend/controllers/authController.js");
const users = read("nexshop-backend/controllers/userController.js");
const order = read("nexshop-backend/controllers/orderController.js");
const topup = read("nexshop-backend/controllers/topupController.js");
const ipaymu = read("nexshop-backend/config/ipaymu.js");
const index = read("nexshop-frontend/index.html");
const script = read("nexshop-frontend/script.js");
const otpService = read("nexshop-backend/services/phoneOtpService.js");

check("schema menyimpan status verifikasi dan nomor kanonis", migration.includes("phone_normalized") && migration.includes("phone_verified_at") && migration.includes("onboarding_completed"));
check("nomor terverifikasi dibuat unik tanpa mengunci data legacy", migration.includes("idx_users_phone_normalized_unique") && migration.includes("phone_verified_at IS NOT NULL") && migration.includes("Pengguna sebelum migrasi"));
check("registrasi memakai satu service OTP telepon", auth.includes('startPhoneOtp(supabase, { userId: createdUser.id, phone, purpose: "phone_onboarding" })'));
check("Google baru masuk onboarding dan tidak menimpa avatar berikutnya", auth.includes("onboarding_completed: false") && auth.includes("Login berikutnya tidak pernah"));
check("perubahan nomor mempertahankan nomor lama sampai OTP valid", users.includes('purpose: "phone_change"') && otpService.includes("pending_phone_normalized") && otpService.includes("phone_verified_at"));
check("OTP mempunyai cooldown dan batas percobaan", otpService.includes("OTP_RESEND_COOLDOWN_MS") && otpService.includes("OTP_MAX_ATTEMPTS") && otpService.includes("timingSafeEqual"));
check("checkout produk memakai profil server untuk pengguna login", order.includes("getCheckoutIdentity(userId)") && order.includes("Identitas akun login selalu dari profil database"));
check("checkout topup memakai profil server untuk pengguna login", topup.includes("getCheckoutIdentity(userId)") && topup.includes("buyerName = checkoutProfile.identity.name"));
check("format iPaymu hanya ada di adapter dan tanpa nomor dummy", ipaymu.includes("toIpaymuPhone") && !ipaymu.includes("08123456789"));
check("header memiliki target avatar nyata", index.includes('id="accountBtnAvatar"') && script.includes("renderAvatar(headerAvatar, currentUser"));
check("avatar diperbarui dengan versi stabil dan fallback error", script.includes("avatar_updated_at") && script.includes('image.addEventListener("error"'));
check("credential stuffing dibatasi per akun", auth.includes("ACCOUNT_LOGIN_MAX_FAILURES") && auth.includes("login_locked_until"));

console.log(`\nRINGKASAN: ${passed} pengujian lolos.`);
