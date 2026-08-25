/**
 * userWhatsAppService.js — REPLACED from Fonnte to NexShop WA API (local server)
 *
 * Original: kirim ke https://api.fonnte.com/send
 * Sekarang : kirim ke WA API server yang running di http://127.0.0.1:8080 (Baileys)
 *
 * Interface tetap sama (sendUserWhatsApp, testFonnteConnection, parseTemplate)
 * supaya semua controller (auth, order, topup, notificationDelivery) nggak perlu diubah.
 *
 * WA API endpoints:
 *   POST /send-otp         — template: login_otp, login_warning
 *   POST /send-transaction — status: pending, success, failed
 *
 * Semua template (otp/pending/success) tetap dikelola via Settings > API Keys di NexShop admin
 * (fields: wa_template_otp, wa_template_pending, wa_template_success, fonnte_user_enabled, dll).
 * Template ini akan diparse lalu dikirim sebagai custom `message` ke WA API.
 */

const axios = require("axios");
const { getApiKeys, getStoreSettings } = require("../config/settings");
const { normalizePhoneNumber, toFonntePhone } = require("../utils/phoneNumber");

// WA API server konfigurasi — ambil dari apiKeys (wa_api_url) supaya fleksibel
const WA_API_BASE = process.env.WA_API_URL || "http://127.0.0.1:8080";
const WA_API_KEY = process.env.WA_API_KEY || "nexshop-wa-2024-secure-key";

/**
 * Mengganti template variables (misal: {name}, {order_id}) dengan data asli
 */
function parseTemplate(template, data) {
    let result = template;
    for (const key in data) {
        result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), data[key] || '');
    }
    return result;
}

/**
 * Helper: kirim ke WA API server (Baileys)
 * - POST /send-otp untuk type "otp"
 * - POST /send-transaction untuk type "pending"/"success"
 */
async function sendToWaApi(phone, type, variables, extraMessage, customMessage) {
    const payload = {
        phone: phone,
        message: customMessage || undefined
    };

    if (type === "otp") {
        payload.otp = variables.otp || '';
        payload.template = "login_otp";
    } else if (type === "pending") {
        payload.orderId = variables.order_id || variables.orderId || '';
        payload.status = "pending";
        payload.amount = variables.total || variables.amount || '';
    } else if (type === "success") {
        payload.orderId = variables.order_id || variables.orderId || '';
        payload.status = "success";
        payload.amount = variables.total || variables.amount || '';
    } else if (type === "failed") {
        payload.orderId = variables.order_id || variables.orderId || '';
        payload.status = "failed";
        payload.amount = variables.total || variables.amount || '';
    }

    // Jika custom message diberikan, kirim sebagai message (WA API akan pakai ini)
    const url = (type === "otp")
        ? `${WA_API_BASE}/send-otp`
        : `${WA_API_BASE}/send-transaction`;

    const resp = await axios.post(url, payload, {
        headers: {
            "Content-Type": "application/json",
            "X-API-Key": WA_API_KEY
        },
        timeout: 15000
    });

    return resp.data;
}

/**
 * Fungsi utama untuk kirim WA ke user
 * type: 'otp' | 'pending' | 'success' | 'failed'
 */
async function sendUserWhatsApp(targetNumber, type, variables = {}, extraMessage = "") {
    try {
        const canonicalTarget = toFonntePhone(String(targetNumber || ""));
        if (!canonicalTarget) return { success: false, reason: "invalid_phone" };

        const apiKeys = await getApiKeys();
        const settings = await getStoreSettings();

        // Cek apakah fitur WA diaktifkan secara global
        if (!settings.fonnte_user_enabled) return { success: false, reason: "disabled_globally" };

        // Map template dari settings (biarkan admin edit template via dashboard)
        let template = "";
        let enabledFlag = true;
        if (type === "pending") {
            enabledFlag = settings.wa_notify_pending_enabled;
            template = settings.wa_template_pending || "";
        } else if (type === "success") {
            enabledFlag = settings.wa_notify_success_enabled;
            template = settings.wa_template_success || "";
        } else if (type === "otp") {
            enabledFlag = settings.wa_notify_otp_enabled;
            template = settings.wa_template_otp || "";
        } else {
            return { success: false, reason: "invalid_type" };
        }

        if (!enabledFlag) return { success: false, reason: "disabled_type" };

        // Parse template jika ada (dari settings admin)
        let message = "";
        if (template) {
            message = parseTemplate(template, variables);
            if (extraMessage) message += `\n\n${extraMessage}`;
        }

        console.log(`[WA API] Kirim ke ${canonicalTarget}, type: ${type}, orderId: ${variables.order_id || variables.orderId || 'N/A'}`);

        const result = await sendToWaApi(canonicalTarget, type, variables, extraMessage, message);

        if (result && result.success) {
            return { success: true, response: result, status: "sent" };
        } else {
            return { success: false, reason: "api_error", error: result?.message || "unknown error", status: "failed" };
        }

    } catch (err) {
        console.error("Kesalahan saat mengirim WA via WA API:", err.message);

        let errorCategory = "transient"; // default
        let status = err.response?.status || null;
        if (err.response) {
            if ([400, 401, 403, 404, 405, 422].includes(status)) {
                errorCategory = "permanent";
            }
        }

        return {
            success: false,
            reason: errorCategory,
            error: err.response?.data || err.message,
            status: status
        };
    }
}

/**
 * Test koneksi WA API (ganti dari Fonnte test connection)
 * Dipanggil dari Settings > API Keys dashboard "Test" button
 */
async function testFonnteConnection(targetNumber, messageText) {
    try {
        // Gunakan endpoint /send-otp sebagai test, kirim OTP dummy
        const canonicalTarget = toFonntePhone(String(targetNumber || ""));
        if (!canonicalTarget) throw new Error("Nomor WhatsApp tidak valid");

        const resp = await axios.post(`${WA_API_BASE}/send-otp`, {
            phone: canonicalTarget,
            otp: "000000",
            message: messageText || `🧪 Test koneksi NexShop WA API — berhasil! ✅`
        }, {
            headers: {
                "Content-Type": "application/json",
                "X-API-Key": WA_API_KEY
            },
            timeout: 15000
        });

        return resp.data;
    } catch (err) {
        throw new Error(`Gagal kirim WA: ${err.response?.data?.message || err.message}`);
    }
}

module.exports = {
    sendUserWhatsApp,
    testFonnteConnection,
    parseTemplate,
    sendToWaApi  // export juga untuk pemakaian langsung/testing
};
