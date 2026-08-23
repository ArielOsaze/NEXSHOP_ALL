const crypto = require("crypto");
const axios = require("axios");
const supabase = require("../config/db");

/**
 * Buat signature HMAC-SHA256 untuk payload webhook reseller
 */
function generateWebhookSignature(payload, secret) {
    const stringPayload = typeof payload === "string" ? payload : JSON.stringify(payload);
    return crypto.createHmac("sha256", secret).update(stringPayload).digest("hex");
}

/**
 * Kirim webhook notifikasi ke website reseller saat order selesai/berubah status
 */
async function dispatchResellerWebhook(order, eventType = "transaction.updated") {
    if (!order) return;

    try {
        const userId = order.reseller_user_id || order.user_id;
        if (!userId) return;

        // Ambil data webhook reseller dari tabel reseller_api_keys
        const { data: keyRecord } = await supabase
            .from("reseller_api_keys")
            .select("id, webhook_url, webhook_secret, secret_key, is_active")
            .eq("user_id", userId)
            .maybeSingle();

        if (!keyRecord || !keyRecord.is_active || !keyRecord.webhook_url) {
            return;
        }

        const webhookUrl = keyRecord.webhook_url.trim();
        if (!webhookUrl.startsWith("http://") && !webhookUrl.startsWith("https://")) {
            return;
        }

        const secret = keyRecord.webhook_secret || keyRecord.secret_key || "nexshop-default-secret";

        let normalizedStatus = "PROCESSING";
        if (order.status === "sukses") normalizedStatus = "SUCCESS";
        else if (order.status === "gagal" || order.status === "failed") normalizedStatus = "FAILED";

        const payload = {
            event: eventType,
            reference_id: order.reseller_ref_id || order.ref_id || order.id,
            order_id: order.id,
            status: normalizedStatus,
            product_code: order.kode_produk,
            product_name: order.nama_produk,
            target: order.tujuan,
            server_id: order.server_id || null,
            amount: Number(order.harga) || 0,
            serial_number: order.tv_sn || null,
            message: order.tv_message || (normalizedStatus === "SUCCESS" ? "Transaksi Berhasil" : "Transaksi Sedang Diproses"),
            timestamp: new Date().toISOString()
        };

        const signature = generateWebhookSignature(payload, secret);

        // Kirim HTTP POST ke webhook URL reseller (timeout 10 detik)
        axios.post(webhookUrl, payload, {
            headers: {
                "Content-Type": "application/json",
                "X-NexShop-Signature": signature,
                "X-NexShop-Event": eventType,
                "User-Agent": "NexShop-Webhook-Relay/1.0"
            },
            timeout: 10000
        }).then(res => {
            console.log(`[Reseller Webhook] Sent to ${webhookUrl} (Status: ${res.status})`);
        }).catch(err => {
            console.log(`[Reseller Webhook Error] Failed to send to ${webhookUrl}: ${err.message}`);
        });
    } catch (err) {
        console.log(`[Reseller Webhook Dispatch Error]: ${err.message}`);
    }
}

module.exports = {
    generateWebhookSignature,
    dispatchResellerWebhook
};
