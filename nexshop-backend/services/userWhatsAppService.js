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
const { getApiKeys, getStoreSettings, getWaApiConfig } = require("../config/settings");
const { normalizePhoneNumber, toFonntePhone } = require("../utils/phoneNumber");

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
 *
 * URL & Key WA API diambil dari getWaApiConfig() — utamakan yang tersimpan
 * di dashboard (Settings > API Keys), .env cuma fallback darurat. Ini
 * supaya admin bisa ganti WA API server dari dashboard tanpa perlu edit
 * .env di VPS (env lokal & VPS bisa beda).
 */
async function sendToWaApi(phone, type, variables, extraMessage, customMessage) {
    const { url, key } = await getWaApiConfig();

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
    const targetUrl = (type === "otp")
        ? `${url}/send-otp`
        : `${url}/send-transaction`;

    const resp = await axios.post(targetUrl, payload, {
        headers: {
            "Content-Type": "application/json",
            "X-API-Key": key
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
        } else if (type === "failed") {
            // Tidak ada template khusus gagal pada UI lama. Gateway akan
            // membentuk pesan status gagal yang aman bila message kosong.
            enabledFlag = settings.wa_notify_success_enabled;
            template = "";
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

        const { url, key } = await getWaApiConfig();
        const resp = await axios.post(`${url}/send-otp`, {
            phone: canonicalTarget,
            otp: "000000",
            message: messageText || `🧪 Test koneksi NexShop WA API — berhasil! ✅`
        }, {
            headers: {
                "Content-Type": "application/json",
                "X-API-Key": key
            },
            timeout: 15000
        });

        return resp.data;
    } catch (err) {
        throw new Error(`Gagal kirim WA: ${err.response?.data?.message || err.message}`);
    }
}

/**
 * Jalur pesan kampanye sengaja terpisah dari sendUserWhatsApp(): ia tidak
 * tunduk pada toggle notifikasi transaksional dan dipanggil oleh worker yang
 * membatasi satu penerima per interval. Gateway tetap menerima satu nomor per
 * request; tidak ada endpoint bulk di service ini.
 */
async function sendMarketingWhatsApp(targetNumber, message) {
    try {
        const canonicalTarget = toFonntePhone(String(targetNumber || ""));
        if (!canonicalTarget) return { success: false, reason: "permanent", error: "Nomor WhatsApp tidak valid." };
        const text = String(message || "").trim();
        if (!text || text.length > 4096) return { success: false, reason: "permanent", error: "Pesan kampanye tidak valid." };

        const { url, key } = await getWaApiConfig();
        if (!key) return { success: false, reason: "permanent", error: "API Key WA Gateway belum dikonfigurasi." };
        const response = await axios.post(`${url}/send-message`, { phone: canonicalTarget, message: text }, {
            headers: { "Content-Type": "application/json", "X-API-Key": key },
            timeout: 15000
        });
        return response.data?.success === false
            ? { success: false, reason: "permanent", error: response.data.message || "Gateway menolak pesan." }
            : { success: true, response: response.data };
    } catch (err) {
        return {
            success: false,
            reason: [400, 401, 403, 404, 422].includes(err.response?.status) ? "permanent" : "transient",
            error: err.response?.data?.message || err.message
        };
    }
}

module.exports = {
    sendUserWhatsApp,
    testFonnteConnection,
    parseTemplate,
    sendToWaApi,  // export juga untuk pemakaian langsung/testing
    sendMarketingWhatsApp
};
