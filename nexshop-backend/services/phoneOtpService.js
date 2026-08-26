const crypto = require("crypto");
const { sendUserWhatsApp } = require("./userWhatsAppService");
const { normalizePhoneNumber, toFonntePhone } = require("../utils/phoneNumber");

const OTP_EXPIRY_MINUTES = 5;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

function generateOtp() {
    return String(crypto.randomInt(100000, 1000000));
}

function hashOtp(otp) {
    return crypto.createHash("sha256").update(otp).digest("hex");
}

async function assertPhoneAvailable(supabase, phoneNormalized, userId) {
    let query = supabase
        .from("users")
        .select("id")
        .or(`phone_normalized.eq.${phoneNormalized},pending_phone_normalized.eq.${phoneNormalized}`);
    if (userId) query = query.neq("id", userId);
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    if (data) {
        const err = new Error("Nomor WhatsApp tersebut sudah digunakan pada akun lain.");
        err.code = "PHONE_ALREADY_IN_USE";
        throw err;
    }
}

async function startPhoneOtp(supabase, { userId, phone, purpose }) {
    const normalized = normalizePhoneNumber(phone);
    if (!normalized) {
        const err = new Error("Nomor WhatsApp tidak valid. Gunakan nomor Indonesia yang aktif.");
        err.code = "PHONE_INVALID";
        throw err;
    }
    if (!['phone_onboarding', 'phone_change'].includes(purpose)) {
        throw new Error("Tujuan verifikasi nomor tidak valid.");
    }

    await assertPhoneAvailable(supabase, normalized, userId);
    const { data: user, error: userErr } = await supabase
        .from("users")
        .select("id, email, fullname, phone_normalized, phone_verified_at, otp_sent_at")
        .eq("id", userId)
        .maybeSingle();
    if (userErr) throw userErr;
    if (!user) throw new Error("Akun tidak ditemukan.");

    if (user.phone_normalized === normalized && user.phone_verified_at) {
        return { alreadyVerified: true, phone: normalized };
    }
    if (user.otp_sent_at && Date.now() - new Date(user.otp_sent_at).getTime() < OTP_RESEND_COOLDOWN_MS) {
        const err = new Error("Tunggu satu menit sebelum meminta kode OTP lagi.");
        err.code = "OTP_COOLDOWN";
        throw err;
    }

    const otp = generateOtp();
    const now = new Date();
    const { error: updateErr } = await supabase
        .from("users")
        .update({
            pending_phone_normalized: normalized,
            otp_code: hashOtp(otp),
            otp_expires_at: new Date(now.getTime() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString(),
            otp_purpose: purpose,
            otp_attempts: 0,
            otp_sent_at: now.toISOString()
        })
        .eq("id", userId);
    if (updateErr) throw updateErr;

    const delivery = await sendUserWhatsApp(toFonntePhone(normalized), "otp", {
        otp,
        name: user.fullname,
        email: user.email
    });
    if (!delivery.success) {
        const err = new Error("Kode OTP belum dapat dikirim ke WhatsApp. Periksa konfigurasi notifikasi lalu coba lagi.");
        err.code = "OTP_DELIVERY_FAILED";
        throw err;
    }
    return { phone: normalized, expiresInMinutes: OTP_EXPIRY_MINUTES };
}

async function verifyPhoneOtp(supabase, { userId, otp }) {
    if (typeof otp !== "string" || !/^\d{6}$/.test(otp)) {
        const err = new Error("Kode OTP harus 6 digit angka.");
        err.code = "OTP_INVALID";
        throw err;
    }
    const { data: user, error } = await supabase
        .from("users")
        .select("id, pending_phone_normalized, otp_code, otp_expires_at, otp_purpose, otp_attempts")
        .eq("id", userId)
        .maybeSingle();
    if (error) throw error;
    if (!user) throw new Error("Akun tidak ditemukan.");
    if (!['phone_onboarding', 'phone_change'].includes(user.otp_purpose) || !user.pending_phone_normalized || !user.otp_code) {
        const err = new Error("Tidak ada verifikasi nomor yang aktif. Minta kode OTP baru.");
        err.code = "OTP_NOT_ACTIVE";
        throw err;
    }
    if (!user.otp_expires_at || new Date(user.otp_expires_at) <= new Date()) {
        const err = new Error("Kode OTP sudah kedaluwarsa. Minta kode baru.");
        err.code = "OTP_EXPIRED";
        throw err;
    }
    if (Number(user.otp_attempts || 0) >= OTP_MAX_ATTEMPTS) {
        const err = new Error("Terlalu banyak kode yang salah. Minta kode OTP baru.");
        err.code = "OTP_ATTEMPTS_EXCEEDED";
        throw err;
    }
    const expectedHash = hashOtp(otp);
    if (user.otp_code.length !== expectedHash.length || !crypto.timingSafeEqual(Buffer.from(user.otp_code), Buffer.from(expectedHash))) {
        await supabase.from("users")
            .update({ otp_attempts: Number(user.otp_attempts || 0) + 1 })
            .eq("id", userId)
            .eq("otp_code", user.otp_code);
        const err = new Error("Kode OTP salah. Periksa kembali atau minta kode baru.");
        err.code = "OTP_MISMATCH";
        throw err;
    }

    await assertPhoneAvailable(supabase, user.pending_phone_normalized, userId);
    const now = new Date().toISOString();
    const { data: updated, error: updateErr } = await supabase
        .from("users")
        .update({
            phone: user.pending_phone_normalized,
            phone_normalized: user.pending_phone_normalized,
            phone_verified_at: now,
            pending_phone_normalized: null,
            onboarding_completed: true,
            otp_code: null,
            otp_expires_at: null,
            otp_purpose: null,
            otp_attempts: 0,
            otp_sent_at: null
        })
        .eq("id", userId)
        .eq("otp_code", user.otp_code)
        .eq("otp_expires_at", user.otp_expires_at)
        .select("id, fullname, email, role, avatar_url, phone, phone_normalized, phone_verified_at, onboarding_completed")
        .maybeSingle();
    if (updateErr) throw updateErr;
    if (!updated) {
        const err = new Error("Kode OTP sudah dipakai atau tidak lagi aktif. Minta kode baru.");
        err.code = "OTP_ALREADY_USED";
        throw err;
    }
    return updated;
}

module.exports = {
    OTP_EXPIRY_MINUTES,
    generateOtp,
    hashOtp,
    assertPhoneAvailable,
    startPhoneOtp,
    verifyPhoneOtp
};
