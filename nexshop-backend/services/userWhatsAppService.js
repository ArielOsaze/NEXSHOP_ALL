const axios = require("axios");
const { getApiKeys, getStoreSettings } = require("../config/settings");

/**
 * Mengganti template variables (misal: {name}, {order_id}) dengan data asli
 */
function parseTemplate(template, data) {
    let result = template;
    for (const key in data) {
        // Replace semua occurrence dari {key}
        result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), data[key] || '');
    }
    return result;
}

/**
 * Fungsi utama untuk kirim WA ke user via Fonnte
 * tipe: 'pending' | 'success' | 'otp'
 *
 * extraMessage (opsional): blok teks tambahan yang DITEMPEL setelah hasil
 * template admin, dipakai buat detail transaksi yang otomatis (nama produk,
 * ID Pelanggan/Nomor Tujuan, No. Token/SN + instruksi cara pakai). Ini
 * SENGAJA ditempel di KODE, bukan lewat placeholder {xxx} di template admin
 * -- supaya tetap terkirim walau admin belum pernah edit template WA-nya
 * dari default.
 */
async function sendUserWhatsApp(targetNumber, type, variables = {}, extraMessage = "") {
    try {
        const apiKeys = await getApiKeys();
        const settings = await getStoreSettings();

        // Cek apakah fitur Fonnte diaktifkan secara global
        if (!settings.fonnte_user_enabled) return { success: false, reason: "disabled_globally" };

        const token = apiKeys.fonnte_token;
        if (!token) {
            console.log("⚠️ Fonnte Token belum dikonfigurasi.");
            return { success: false, reason: "missing_token" };
        }

        // Cek apakah tipe notifikasi ini diaktifkan
        let template = "";
        if (type === "pending") {
            if (!settings.wa_notify_pending_enabled) return { success: false, reason: "disabled_type" };
            template = settings.wa_template_pending;
        } else if (type === "success") {
            if (!settings.wa_notify_success_enabled) return { success: false, reason: "disabled_type" };
            template = settings.wa_template_success;
        } else if (type === "otp") {
            if (!settings.wa_notify_otp_enabled) return { success: false, reason: "disabled_type" };
            template = settings.wa_template_otp;
        } else {
            return { success: false, reason: "invalid_type" };
        }

        if (!template) {
            console.log(`⚠️ Template WhatsApp untuk ${type} kosong.`);
            return { success: false, reason: "missing_template" };
        }

        let message = parseTemplate(template, variables);
        if (extraMessage) message += `\n\n${extraMessage}`;

        const response = await axios.post(
            "https://api.fonnte.com/send",
            {
                target: targetNumber,
                message: message
            },
            {
                headers: {
                    Authorization: token
                },
                timeout: 10000 // 10 detik agar tidak hang
            }
        );

        if (response.data && response.data.status) {
            return { success: true, response: response.data, status: response.status };
        } else {
            console.log("⚠️ Fonnte API gagal:", response.data);
            return { success: false, reason: "api_error", error: response.data, status: response.status };
        }

    } catch (err) {
        console.error("Kesalahan saat mengirim Fonnte WA:", err.message);
        
        let errorCategory = "unknown"; // default to timeout/disconnect
        let status = null;
        if (err.response) {
            status = err.response.status;
            if ([400, 401, 403, 404, 405, 422].includes(status)) {
                errorCategory = "permanent";
            } else if ([408, 429].includes(status) || (status >= 500 && status <= 599)) {
                errorCategory = "transient";
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
 * Khusus untuk testing dari Admin Dashboard
 */
async function testFonnteConnection(targetNumber, messageText) {
    try {
        // fresh:true — test dari dashboard harus selalu baca token TERBARU dari
        // DB, gak boleh kena cache 30 detik (bisa bikin "belum dikonfigurasi"
        // padahal admin baru saja save).
        const apiKeys = await getApiKeys({ fresh: true });
        const token = apiKeys.fonnte_token;
        if (!token) throw new Error("Fonnte Token belum dikonfigurasi");

        const response = await axios.post(
            "https://api.fonnte.com/send",
            {
                target: targetNumber,
                message: messageText
            },
            {
                headers: {
                    Authorization: token
                },
                timeout: 10000
            }
        );

        return response.data;
    } catch (err) {
        throw err;
    }
}

module.exports = {
    sendUserWhatsApp,
    testFonnteConnection,
    parseTemplate
};
