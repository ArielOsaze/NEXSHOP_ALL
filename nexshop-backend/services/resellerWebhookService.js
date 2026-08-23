const crypto = require("crypto");
const axios = require("axios");
const supabase = require("../config/db");
const { assertSafeOutboundUrl } = require("../utils/safeOutboundUrl");

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

        // Cek anti-SSRF penuh (skema, port, dan resolusi DNS harus mendarat
        // di IP publik) -- lihat utils/safeOutboundUrl.js. Pengecekan lama
        // cuma memastikan string-nya diawali http:// atau https://, sehingga
        // "http://127.0.0.1:5432/" pun lolos.
        const cek = await assertSafeOutboundUrl(keyRecord.webhook_url);
        if (!cek.ok) {
            console.log(`[Reseller Webhook] Dilewati untuk user ${userId}: ${cek.reason}`);
            return;
        }
        const webhookUrl = cek.url;

        // Kalau webhook_secret belum ada, JANGAN jatuh ke string konstan yang
        // ikut ter-commit di repo -- signature-nya jadi bisa dipalsukan siapa
        // pun. Lebih baik webhook tidak dikirim daripada dikirim dengan
        // signature yang tidak membuktikan apa-apa.
        const secret = keyRecord.webhook_secret || keyRecord.secret_key;
        if (!secret) {
            console.log(`[Reseller Webhook] Dilewati untuk user ${userId}: webhook_secret belum di-provision.`);
            return;
        }

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
            timeout: 10000,
            maxRedirects: 0,
            maxContentLength: 64 * 1024,
            maxBodyLength: 64 * 1024
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
