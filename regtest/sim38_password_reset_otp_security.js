"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const phoneOtp = fs.readFileSync(path.join(root, "nexshop-backend/services/phoneOtpService.js"), "utf8").replace(/\r\n/g, "\n");
const auth = fs.readFileSync(path.join(root, "nexshop-backend/controllers/authController.js"), "utf8").replace(/\r\n/g, "\n");
const loginSecurity = fs.readFileSync(path.join(root, "nexshop-backend/services/loginSecurityNotificationService.js"), "utf8").replace(/\r\n/g, "\n");
const mailer = fs.readFileSync(path.join(root, "nexshop-backend/config/mailer.js"), "utf8").replace(/\r\n/g, "\n");
const settings = fs.readFileSync(path.join(root, "nexshop-backend/config/settings.js"), "utf8").replace(/\r\n/g, "\n");
const waService = fs.readFileSync(path.join(root, "nexshop-backend/services/userWhatsAppService.js"), "utf8").replace(/\r\n/g, "\n");
const migration = fs.readFileSync(path.join(root, "nexshop-backend/migrations/020_harden_otp_and_password_reset.sql"), "utf8").replace(/\r\n/g, "\n");

assert.match(phoneOtp, /const OTP_EXPIRY_MINUTES = 5;/, "OTP WhatsApp harus expired 5 menit");
assert.match(auth, /passwordResetService/, "Auth harus memakai sumber expiry reset terpusat");
assert.match(mailer, /Kode ini berlaku selama 5 menit/, "OTP email harus menyebut expiry 5 menit");
assert.match(settings, /Kode ini berlaku selama 5 menit/, "Template OTP WhatsApp default harus menyebut expiry 5 menit");
assert.match(migration, /reset_password_token = NULL/);
assert.match(migration, /wa_template_otp = regexp_replace/);
assert.doesNotMatch(loginSecurity, /#\/forgot-password/, "Login alert tidak boleh mengirim link forgot-password generik");
assert.match(loginSecurity, /createPasswordResetToken/, "Login alert harus membuat token reset unik");
assert.match(auth, /createPasswordResetToken/);
assert.match(auth, /sendUserSecurityWhatsApp/);
assert.match(auth, /phone_normalized/, "Forgot password harus mengambil nomor WhatsApp kanonis");
assert.match(auth, /\.eq\("reset_password_token", tokenHash\)[\s\S]*\.select\("id"\)/, "Konsumsi token harus atomic\/single-use");
assert.match(auth, /\.eq\("otp_code", user\.otp_code\)[\s\S]*\.select\("id"\)/, "OTP email harus atomic\/single-use");
assert.match(phoneOtp, /\.eq\("otp_code", user\.otp_code\)[\s\S]*\.select\(/, "OTP WhatsApp harus atomic\/single-use");
assert.match(waService, /sendUserSecurityWhatsApp/, "Jalur WA security harus tersedia untuk reset link");

const resetServicePath = path.join(root, "nexshop-backend/services/passwordResetService.js");
assert.ok(fs.existsSync(resetServicePath), "passwordResetService harus menjadi sumber token reset bersama");
const resetService = require(resetServicePath);
assert.strictEqual(resetService.PASSWORD_RESET_EXPIRY_MINUTES, 5);
const first = resetService.createPasswordResetToken();
const second = resetService.createPasswordResetToken();
assert.match(first.token, /^[a-f0-9]{64}$/);
assert.match(first.tokenHash, /^[a-f0-9]{64}$/);
assert.notStrictEqual(first.token, second.token);
assert.notStrictEqual(first.tokenHash, second.tokenHash);
assert.ok(new Date(first.expiresAt).getTime() - Date.now() <= 5 * 60 * 1000);
assert.ok(new Date(first.expiresAt).getTime() - Date.now() > 4 * 60 * 1000);
assert.strictEqual(resetService.hashResetToken(first.token), first.tokenHash);

console.log("sim38_password_reset_otp_security: passed");
