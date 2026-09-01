"use strict";

function normalizeEmail(rawEmail) {
    const value = typeof rawEmail === "string" ? rawEmail.trim() : "";
    const at = value.lastIndexOf("@");
    if (at <= 0 || at === value.length - 1) return value;
    return `${value.slice(0, at)}@${value.slice(at + 1).toLowerCase()}`;
}

function validateEmail(rawEmail) {
    const value = normalizeEmail(rawEmail);
    if (!value) return { valid: false, value, message: "Email wajib diisi." };
    if (value.length > 254) return { valid: false, value, message: "Email terlalu panjang." };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        return { valid: false, value, message: "Format email belum valid. Contoh: user@gmail.com." };
    }
    return { valid: true, value, message: "" };
}

module.exports = { normalizeEmail, validateEmail };
