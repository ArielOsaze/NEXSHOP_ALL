const supabase = require('../config/db');
const { sendUserWhatsApp } = require('./userWhatsAppService');
const { resolveUserDisplayName } = require('./userNotificationHelpers');
const crypto = require('crypto');
const {
    resolveNexshopCategory,
    isPascabayarProduct,
    getTargetFieldMeta,
    parsePlnTokenSn,
    getSerialInstruction
} = require('../utils/topupHelpers');

function rupiahLog(n) {
    return "Rp" + Number(n).toLocaleString("id-ID");
}

// ===========================================================
// Blok detail transaksi yang ditempel ke notif WA sukses topup — nama
// produk, label field tujuan yang SESUAI kategori produknya (ID
// Pelanggan/Nomor HP/Player ID, dst — bukan cuma "Nomor Tujuan" generik),
// dan kalau sudah ada No. Token/SN, dipisah jadi baris sendiri + instruksi
// cara pakainya (khusus token PLN Prabayar: SN gabungan dipecah jadi "No.
// Token" & "Keterangan" biar gak nyampur sama nomor yang harus dimasukin
// ke meteran).
// ===========================================================
async function buildTopupDetailBlock(topup) {
    if (!topup) return "";

    let displayCategory = "Lainnya";
    let isPascabayar = false;
    if (topup.kode_produk) {
        const [{ data: productRow }, { data: categoryRows }] = await Promise.all([
            supabase
                .from('topup_products')
                .select('kategori, source_category_id, source_category_name, manual_category_override')
                .eq('kode_produk', topup.kode_produk)
                .maybeSingle(),
            supabase.from('topup_category_map').select('tokovoucher_category_name, nexshop_category_name')
        ]);
        if (productRow) {
            const categoryMap = new Map((categoryRows || []).map(r => [r.tokovoucher_category_name, r.nexshop_category_name]));
            displayCategory = resolveNexshopCategory(productRow, categoryMap);
            isPascabayar = isPascabayarProduct(productRow);
        }
    }

    const meta = getTargetFieldMeta(displayCategory, isPascabayar);
    const lines = [`Produk: ${topup.nama_produk || "-"}`];
    lines.push(`${meta.resultLabel}: ${topup.tujuan || "-"}${topup.server_id ? ` (Server: ${topup.server_id})` : ""}`);

    if (topup.tv_sn) {
        if (displayCategory.toLowerCase() === "pln" && !isPascabayar) {
            const parsed = parsePlnTokenSn(topup.tv_sn);
            lines.push("");
            lines.push(`No. Token : ${parsed.token}`);
            if (parsed.keterangan) lines.push(`Keterangan : ${parsed.keterangan}`);
        } else {
            lines.push("");
            lines.push(`Kode/SN : ${topup.tv_sn}`);
        }
        lines.push("");
        lines.push(getSerialInstruction(displayCategory, isPascabayar));
    }

    return lines.join("\n");
}

async function fetchNotificationPayload(orderId, notificationType) {
    // Reconstruct payload dynamically so we don't store PII in notification_events
    if (orderId.startsWith("TP")) {
        const { data: topup } = await supabase.from('topup_orders').select('*').eq('id', orderId).maybeSingle();
        if (!topup) return null;
        const extraMessage = notificationType === "success" ? await buildTopupDetailBlock(topup) : "";
        return {
            targetNumber: topup.recipient_phone,
            variables: {
                name: resolveUserDisplayName({ fullname: topup.recipient_name, email: topup.recipient_email }),
                email: topup.recipient_email,
                order_id: orderId,
                total: rupiahLog(topup.harga)
            },
            extraMessage
        };
    } else {
        const { data: order } = await supabase.from('orders').select('*').eq('id', orderId).maybeSingle();
        if (!order) return null;
        return {
            targetNumber: order.recipient_phone,
            variables: {
                name: resolveUserDisplayName({ fullname: order.recipient_name, email: order.recipient_email }),
                email: order.recipient_email,
                order_id: orderId,
                total: rupiahLog(order.total)
            },
            extraMessage: ""
        };
    }
}

/**
 * Handles the delivery of a notification, ensuring idempotency and retry logic.
 */
async function processNotificationEvent(orderId, notificationType, type = "success") {
    // 1. Check or Create Event
    let eventId = null;

    try {
        const { data: newEvent, error: insertError } = await supabase
            .from('notification_events')
            .insert([{
                order_id: orderId,
                notification_type: notificationType,
                status: 'pending',
                attempt_count: 0
            }])
            .select()
            .single();

        if (insertError) {
            // Error duplicate insert -> event already exists
            if (insertError.code === '23505') {
                const { data: existing } = await supabase
                    .from('notification_events')
                    .select('id, status')
                    .eq('order_id', orderId)
                    .eq('notification_type', notificationType)
                    .single();

                if (existing) {
                    eventId = existing.id;
                } else {
                    return;
                }
            } else {
                return;
            }
        } else if (newEvent) {
            eventId = newEvent.id;
        }
    } catch (err) {
        return;
    }

    if (!eventId) return;

    // 2. Atomic Claim (Initial)
    const lockToken = crypto.randomUUID();
    
    const { data: claimedEvent, error: claimError } = await supabase
        .from('notification_events')
        .update({
            status: 'sending',
            attempt_count: 1, // first attempt
            locked_at: new Date().toISOString(),
            lock_token: lockToken,
            next_retry_at: null
        })
        .eq('id', eventId)
        .eq('status', 'pending')
        .select()
        .single();

    if (claimError || !claimedEvent) {
        // Did not claim (could be already processed, sent, sending, or failed). Do nothing.
        return;
    }

    // 3. Fetch payload dynamically
    const payload = await fetchNotificationPayload(orderId, notificationType);
    if (!payload) {
        // Fallback safely if order was deleted
        await finalizeNotificationResult(eventId, lockToken, claimedEvent.attempt_count, { success: false, reason: "permanent", error: "Order not found" });
        return;
    }

    // 4. Send WhatsApp
    const result = await sendUserWhatsApp(payload.targetNumber, type, payload.variables, payload.extraMessage);

    // 5. Update Status based on Lock Ownership
    await finalizeNotificationResult(eventId, lockToken, claimedEvent.attempt_count, result);
}

/**
 * Handles retry delivery specifically from the worker
 */
async function processRetryDelivery(candidate) {
    const lockToken = crypto.randomUUID();
    const newAttemptCount = candidate.attempt_count + 1;

    // Atomic Claim (Retry)
    const { data: claimedEvent, error: claimError } = await supabase
        .from('notification_events')
        .update({
            status: 'sending',
            attempt_count: newAttemptCount,
            locked_at: new Date().toISOString(),
            lock_token: lockToken,
            next_retry_at: null
        })
        .eq('id', candidate.id)
        .eq('status', 'failed')
        .lt('attempt_count', 3)
        .lte('next_retry_at', new Date().toISOString())
        .select()
        .single();
    
    if (claimError || !claimedEvent) {
        return; // Failed to claim
    }

    const payload = await fetchNotificationPayload(candidate.order_id, candidate.notification_type);
    if (!payload) {
        await finalizeNotificationResult(candidate.id, lockToken, newAttemptCount, { success: false, reason: "permanent", error: "Order not found" });
        return;
    }

    const result = await sendUserWhatsApp(payload.targetNumber, candidate.notification_type, payload.variables, payload.extraMessage);
    await finalizeNotificationResult(candidate.id, lockToken, newAttemptCount, result);
}


/**
 * Updates the notification event status safely using the lock token.
 */
async function finalizeNotificationResult(eventId, lockToken, attemptCount, result) {
    let newStatus = 'unknown';
    let nextRetry = null;
    let lastError = null;
    let sentAt = null;

    if (result.success) {
        newStatus = 'sent';
        sentAt = new Date().toISOString();
    } else {
        const reason = result.reason;
        
        if (reason === 'permanent' || reason === 'api_error' || reason === 'disabled_globally' || reason === 'disabled_type' || reason === 'missing_token' || reason === 'missing_template' || reason === 'invalid_type') {
            newStatus = 'failed';
            lastError = typeof result.error === 'object' ? JSON.stringify(result.error) : result.error || "Permanent Error";
            nextRetry = null;
        } else if (reason === 'transient') {
            newStatus = 'failed';
            lastError = typeof result.error === 'object' ? JSON.stringify(result.error) : result.error || "Transient Error";
            // Backoff logic: 1m, 5m
            if (attemptCount === 1) {
                nextRetry = new Date(Date.now() + 1 * 60000).toISOString();
            } else if (attemptCount === 2) {
                nextRetry = new Date(Date.now() + 5 * 60000).toISOString();
            } else {
                nextRetry = null; // No more retries after 3 total attempts
            }
        } else {
            // unknown / timeout
            newStatus = 'unknown';
            lastError = typeof result.error === 'object' ? JSON.stringify(result.error) : result.error || "Unknown Error/Timeout";
            nextRetry = null; 
        }
    }

    const { error: finalizeError } = await supabase
        .from('notification_events')
        .update({
            status: newStatus,
            last_error: lastError,
            sent_at: sentAt,
            next_retry_at: nextRetry,
            locked_at: null,
            lock_token: null
        })
        .eq('id', eventId)
        .eq('status', 'sending')
        .eq('lock_token', lockToken);

    if (finalizeError) {
        console.error(`Failed to finalize notification event ${eventId}:`, finalizeError);
    }
}

module.exports = {
    processNotificationEvent,
    processRetryDelivery,
    buildTopupDetailBlock
};
