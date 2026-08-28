"use strict";

const crypto = require("crypto");

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const TOTP_STEP_SECONDS = 30;

function encryptionKey() {
    const configured = String(process.env.PORTAL_2FA_ENCRYPTION_KEY || process.env.JWT_SECRET || "");
    if (!configured) throw new Error("Portal 2FA encryption key is not configured");
    return crypto.createHash("sha256").update(configured, "utf8").digest();
}

function base32Encode(buffer) {
    let bits = 0;
    let value = 0;
    let output = "";
    for (const byte of buffer) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
    return output;
}

function base32Decode(value) {
    const normalized = String(value || "").toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");
    if (!normalized || /[^A-Z2-7]/.test(normalized)) throw new Error("Invalid TOTP secret");
    let bits = 0;
    let current = 0;
    const bytes = [];
    for (const character of normalized) {
        current = (current << 5) | BASE32_ALPHABET.indexOf(character);
        bits += 5;
        if (bits >= 8) {
            bytes.push((current >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }
    return Buffer.from(bytes);
}

function generateTotpSecret() {
    return base32Encode(crypto.randomBytes(20));
}

function totpCode(secret, counter) {
    const key = base32Decode(secret);
    const message = Buffer.alloc(8);
    message.writeBigUInt64BE(BigInt(counter));
    const digest = crypto.createHmac("sha1", key).update(message).digest();
    const offset = digest[digest.length - 1] & 0x0f;
    const binary = ((digest[offset] & 0x7f) << 24) |
        ((digest[offset + 1] & 0xff) << 16) |
        ((digest[offset + 2] & 0xff) << 8) |
        (digest[offset + 3] & 0xff);
    return String(binary % 1000000).padStart(6, "0");
}

function safeEqualText(left, right) {
    const a = Buffer.from(String(left || ""), "utf8");
    const b = Buffer.from(String(right || ""), "utf8");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifyTotp(secret, code, nowMs = Date.now(), window = 1) {
    const normalized = String(code || "").replace(/\s/g, "");
    if (!/^\d{6}$/.test(normalized)) return false;
    const counter = Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);
    for (let delta = -window; delta <= window; delta += 1) {
        if (safeEqualText(totpCode(secret, counter + delta), normalized)) return true;
    }
    return false;
}

function encryptSecret(secret) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(String(secret), "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [iv, tag, ciphertext].map((part) => part.toString("base64url")).join(".");
}

function decryptSecret(payload) {
    const parts = String(payload || "").split(".");
    if (parts.length !== 3) throw new Error("Invalid encrypted TOTP secret");
    const iv = Buffer.from(parts[0], "base64url");
    const tag = Buffer.from(parts[1], "base64url");
    const ciphertext = Buffer.from(parts[2], "base64url");
    if (iv.length !== 12 || tag.length !== 16 || !ciphertext.length) throw new Error("Invalid encrypted TOTP secret");
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

function buildOtpAuthUri(secret, email) {
    const issuer = "NexShop Portal Reseller";
    const label = `${issuer}:${String(email || "portal")}`;
    return `otpauth://totp/${encodeURIComponent(label)}?secret=${encodeURIComponent(secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

function generateRecoveryCodes(count = 8) {
    return Array.from({ length: count }, () => {
        const raw = crypto.randomBytes(5).toString("hex").toUpperCase();
        return `${raw.slice(0, 5)}-${raw.slice(5)}`;
    });
}

function normalizeRecoveryCode(code) {
    return String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

module.exports = {
    buildOtpAuthUri,
    decryptSecret,
    encryptSecret,
    generateRecoveryCodes,
    generateTotpSecret,
    generateTotpCode: (secret, nowMs = Date.now()) => totpCode(secret, Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS)),
    normalizeRecoveryCode,
    verifyTotp
};
