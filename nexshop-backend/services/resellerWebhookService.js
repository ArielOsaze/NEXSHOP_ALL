const crypto = require("crypto");
const axios = require("axios");
const supabase = require("../config/db");
const { assertSafeOutboundUrl } = require("../utils/safeOutboundUrl");

const RETRY_SCHEDULE_MINUTES = [1, 5, 15, 60, 180];
const MAX_ATTEMPTS = RETRY_SCHEDULE_MINUTES.length + 1;
const DELIVERY_TIMEOUT_MS = 10000;
const MAX_RESPONSE_SNIPPET = 500;

/**
 * Buat signature HMAC-SHA256 untuk payload webhook reseller.
 */
function generateWebhookSignature(payload, secret) {
    const stringPayload = typeof payload === "string" ? payload : JSON.stringify(payload);
    return crypto.createHmac("sha256", secret).update(stringPayload).digest("hex");
}

function isWebhookQueueMissing(error) {
    if (!error) return false;
    const code = String(error.code || "");
    const message = String(error.message || "").toLowerCase();
    return code === "42P01" || code === "PGRST205"
        || (message.includes("reseller_webhook_deliveries") && message.includes("does not exist"))
        || (message.includes("could not find the table") && message.includes("reseller_webhook_deliveries"));
}

function normalizedStatus(order) {
    if (order.status === "sukses") return "SUCCESS";
    if (order.status === "gagal" || order.status === "failed") return "FAILED";
    return "PROCESSING";
}

function buildWebhookPayload(order, eventType) {
    const status = normalizedStatus(order);
    return {
        event: eventType,
        reference_id: order.reseller_ref_id || order.ref_id || order.id,
        order_id: order.id,
        status,
        product_code: order.kode_produk,
        product_name: order.nama_produk,
        target: order.tujuan,
        server_id: order.server_id || null,
        amount: Number(order.harga) || 0,
        serial_number: order.tv_sn || null,
        message: order.tv_message || (status === "SUCCESS" ? "Transaksi Berhasil" : "Transaksi Sedang Diproses"),
        timestamp: new Date().toISOString()
    };
}

async function getWebhookKeyRecord(userId) {
    const { data, error } = await supabase
        .from("reseller_api_keys")
        .select("id, webhook_url, webhook_secret, secret_key, is_active")
        .eq("user_id", userId)
        .maybeSingle();
    if (error) throw error;
    return data;
}

async function sendWebhookHttp(payload, keyRecord) {
    const check = await assertSafeOutboundUrl(keyRecord.webhook_url);
    if (!check.ok) {
        return { ok: false, permanent: true, error: check.reason };
    }

    const secret = keyRecord.webhook_secret || keyRecord.secret_key;
    if (!secret) {
        return { ok: false, permanent: true, error: "webhook_secret belum di-provision" };
    }

    const signature = generateWebhookSignature(payload, secret);
    try {
        const response = await axios.post(check.url, payload, {
            headers: {
                "Content-Type": "application/json",
                "X-NexShop-Signature": signature,
                "X-NexShop-Event": payload.event,
                "User-Agent": "NexShop-Webhook-Relay/1.0"
            },
            timeout: DELIVERY_TIMEOUT_MS,
            maxRedirects: 0,
            maxContentLength: 64 * 1024,
            maxBodyLength: 64 * 1024,
            validateStatus: () => true
        });
        const body = typeof response.data === "string" ? response.data : JSON.stringify(response.data || "");
        const ok = response.status >= 200 && response.status < 300;
        return {
            ok,
            status: response.status,
            body: body.slice(0, MAX_RESPONSE_SNIPPET),
            error: ok ? null : `Penerima balas HTTP ${response.status}`
        };
    } catch (error) {
        return { ok: false, status: null, body: null, error: error.message };
    }
}

function schedulePatchAfterFailure(attemptCount, errorMessage, responseStatus, responseBody, permanent = false) {
    const nextDelay = RETRY_SCHEDULE_MINUTES[attemptCount - 1];
    const dead = permanent || attemptCount >= MAX_ATTEMPTS || nextDelay === undefined;
    return {
        status: dead ? "dead" : "failed",
        attempt_count: attemptCount,
        next_retry_at: dead ? null : new Date(Date.now() + nextDelay * 60000).toISOString(),
        last_error: String(errorMessage || "").slice(0, MAX_RESPONSE_SNIPPET),
        response_status: responseStatus === undefined ? null : responseStatus,
        response_body: responseBody ? String(responseBody).slice(0, MAX_RESPONSE_SNIPPET) : null,
        locked_at: null,
        lock_token: null,
        updated_at: new Date().toISOString()
    };
}

async function sendQueuedDelivery(delivery) {
    const attemptCount = (delivery.attempt_count || 0) + 1;
    try {
        const keyRecord = await getWebhookKeyRecord(delivery.reseller_user_id);
        if (!keyRecord || !keyRecord.is_active || !keyRecord.webhook_url) {
            await supabase.from("reseller_webhook_deliveries").update(
                schedulePatchAfterFailure(attemptCount, "Webhook reseller tidak aktif atau URL belum diatur", null, null, true)
            ).eq("id", delivery.id);
            return { ok: false, permanent: true };
        }

        const result = await sendWebhookHttp(delivery.payload, keyRecord);
        if (result.ok) {
            await supabase.from("reseller_webhook_deliveries").update({
                status: "success",
                attempt_count: attemptCount,
                response_status: result.status,
                response_body: result.body,
                last_error: null,
                next_retry_at: null,
                locked_at: null,
                lock_token: null,
                updated_at: new Date().toISOString()
            }).eq("id", delivery.id);
            return result;
        }

        await supabase.from("reseller_webhook_deliveries").update(
            schedulePatchAfterFailure(attemptCount, result.error, result.status, result.body, result.permanent)
        ).eq("id", delivery.id);
        return result;
    } catch (error) {
        await supabase.from("reseller_webhook_deliveries").update(
            schedulePatchAfterFailure(attemptCount, error.message, null, null)
        ).eq("id", delivery.id);
        return { ok: false, error: error.message };
    }
}

/**
 * Kirim status order melalui antrean durable. Payload disimpan tanpa secret;
 * secret aktif dibaca ulang saat delivery dikirim.
 */
async function enqueueResellerWebhook(order, eventType = "transaction.updated") {
    if (!order) return { queued: 0 };
    const userId = order.reseller_user_id || order.user_id;
    if (!userId) return { queued: 0 };

    const keyRecord = await getWebhookKeyRecord(userId);
    if (!keyRecord || !keyRecord.is_active || !keyRecord.webhook_url) return { queued: 0 };

    const payload = buildWebhookPayload(order, eventType);
    const dedupKey = `${String(order.id)}:${eventType}:${payload.status}`;
    const row = {
        reseller_user_id: userId,
        order_id: String(order.id),
        event: eventType,
        dedup_key: dedupKey,
        payload,
        status: "pending",
        attempt_count: 0
    };

    const { data, error } = await supabase
        .from("reseller_webhook_deliveries")
        .upsert(row, { onConflict: "reseller_user_id,dedup_key", ignoreDuplicates: true })
        .select("id");

    if (error) {
        // Instalasi lama belum punya migration 026. Pertahankan perilaku lama
        // agar deploy kode mendahului migration tidak mematikan notifikasi.
        if (isWebhookQueueMissing(error)) {
            const fallback = await sendWebhookHttp(payload, keyRecord);
            if (!fallback.ok) console.log(`[Reseller Webhook Fallback] ${fallback.error}`);
            return { queued: 0, fallback: true, delivered: fallback.ok };
        }
        throw error;
    }

    if ((data || []).length > 0) {
        setImmediate(() => flushResellerWebhookDeliveries().catch((flushError) => {
            console.log("[Reseller Webhook] gagal mengirim antrean:", flushError.message);
        }));
    }
    return { queued: (data || []).length };
}

/**
 * Ambil antrean yang jatuh tempo, claim secara atomik, lalu kirim satu per satu.
 */
async function flushResellerWebhookDeliveries(limit = 20) {
    const now = new Date().toISOString();
    const lockToken = crypto.randomUUID();
    const staleBefore = new Date(Date.now() - 5 * 60000).toISOString();

    const { error: recoverError } = await supabase
        .from("reseller_webhook_deliveries")
        .update({ status: "pending", locked_at: null, lock_token: null, updated_at: now })
        .eq("status", "sending")
        .lt("locked_at", staleBefore);
    if (recoverError) {
        if (isWebhookQueueMissing(recoverError)) return { sent: 0, notSetup: true };
        throw recoverError;
    }

    const { data: candidates, error } = await supabase
        .from("reseller_webhook_deliveries")
        .select("id")
        .in("status", ["pending", "failed"])
        .or(`next_retry_at.is.null,next_retry_at.lte.${now}`)
        .order("created_at", { ascending: true })
        .limit(limit);
    if (error) {
        if (isWebhookQueueMissing(error)) return { sent: 0, notSetup: true };
        throw error;
    }

    let sent = 0;
    for (const candidate of candidates || []) {
        const { data: claimed, error: claimError } = await supabase
            .from("reseller_webhook_deliveries")
            .update({ status: "sending", locked_at: new Date().toISOString(), lock_token: lockToken })
            .eq("id", candidate.id)
            .in("status", ["pending", "failed"])
            .is("locked_at", null)
            .select("*")
            .maybeSingle();
        if (claimError || !claimed) continue;
        await sendQueuedDelivery(claimed);
        sent++;
    }
    return { sent };
}

/**
 * Entry point yang dipakai controller order lama maupun Open API.
 */
async function dispatchResellerWebhook(order, eventType = "transaction.updated") {
    try {
        return await enqueueResellerWebhook(order, eventType);
    } catch (error) {
        console.log(`[Reseller Webhook Dispatch Error]: ${error.message}`);
        return { queued: 0, error: error.message };
    }
}

module.exports = {
    generateWebhookSignature,
    dispatchResellerWebhook,
    enqueueResellerWebhook,
    flushResellerWebhookDeliveries,
    isWebhookQueueMissing,
    MAX_ATTEMPTS
};
