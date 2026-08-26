"use strict";

const axios = require("axios");
const supabase = require("../config/db");
const { getWaApiConfig } = require("../config/settings");
const { toFonntePhone, normalizePhoneNumber } = require("../utils/phoneNumber");
const { resolveUserDisplayName } = require("./userNotificationHelpers");
const {
    ABANDONED_CHECKOUT_DELAY_DAYS,
    shouldScheduleAbandonedCheckout,
    buildAbandonedCheckoutMessage,
    shouldSendCampaignToContact,
    normalizeIncomingContact,
    personalizeCampaignMessage
} = require("./waMarketingRules");

const FRONTEND_URL = (process.env.FRONTEND_URL || "https://nexshop.cloud").replace(/\/$/, "");
const MAX_CAMPAIGN_RECIPIENTS = 500;
const CAMPAIGN_THROTTLE_MS = Math.max(250, Number(process.env.WA_MARKETING_THROTTLE_MS || 1500));

function isAllowedMediaUrl(rawUrl) {
    if (!rawUrl) return true;
    try {
        const parsed = new URL(String(rawUrl));
        if (!['https:', 'http:'].includes(parsed.protocol)) return false;
        if (parsed.username || parsed.password) return false;
        const hostname = parsed.hostname.toLowerCase();
        if (["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(hostname) || hostname.endsWith(".local")) return false;
        return String(rawUrl).length <= 2048;
    } catch (_) {
        return false;
    }
}

function assertCampaignInput(input) {
    const kind = String(input?.kind || "manual");
    if (!["promo", "voucher", "manual"].includes(kind)) throw new Error("Jenis campaign tidak valid.");
    const title = String(input?.title || "").trim();
    const message = String(input?.message || "").trim();
    if (!title || title.length > 160) throw new Error("Judul campaign wajib diisi dan maksimal 160 karakter.");
    if (!message || message.length > 4096) throw new Error("Pesan campaign wajib diisi dan maksimal 4096 karakter.");
    if (!isAllowedMediaUrl(input?.media_url)) throw new Error("URL foto campaign tidak valid atau mengarah ke host lokal.");
    const scheduledAt = input?.scheduled_at ? new Date(input.scheduled_at) : new Date();
    if (Number.isNaN(scheduledAt.getTime())) throw new Error("Waktu pengiriman campaign tidak valid.");
    return { kind, title, message, media_url: input?.media_url ? String(input.media_url).trim() : null, promo_code: input?.promo_code ? String(input.promo_code).trim().toUpperCase() : null, scheduled_at: scheduledAt.toISOString() };
}

async function sendMarketingMessage(phone, message, mediaUrl = null) {
    const normalized = toFonntePhone(String(phone || ""));
    if (!normalized) return { success: false, reason: "invalid_phone" };
    if (!isAllowedMediaUrl(mediaUrl)) return { success: false, reason: "invalid_media_url" };
    const { url, key } = await getWaApiConfig({ fresh: true });
    const endpoint = mediaUrl ? "/send-media" : "/send-message";
    const body = mediaUrl ? { phone: normalized, mediaUrl, caption: message } : { phone: normalized, message };
    try {
        const response = await axios.post(`${url}${endpoint}`, body, {
            headers: { "Content-Type": "application/json", "X-API-Key": key },
            timeout: 20000
        });
        return { success: response.data?.success !== false, response: response.data };
    } catch (error) {
        return { success: false, reason: "gateway_error", status: error.response?.status || null, error: error.response?.data?.message || error.message };
    }
}

function productNameFromOrder(order) {
    const items = Array.isArray(order?.items) ? order.items : [];
    const names = items.map((item) => String(item?.name || item?.product_name || item?.title || "").trim()).filter(Boolean);
    return names.slice(0, 3).join(", ") || "pesanan kamu";
}

async function getRegisteredUserById(userId) {
    if (!userId) return null;
    const { data, error } = await supabase.from("users").select("id, fullname, email, phone, phone_normalized, phone_verified_at").eq("id", userId).maybeSingle();
    if (error) throw error;
    return data || null;
}

async function getRegisteredUserByPhone(phone) {
    const normalized = normalizePhoneNumber(String(phone || ""));
    if (!normalized) return null;
    const { data: canonical, error: canonicalError } = await supabase.from("users").select("id, fullname, email, phone, phone_normalized, phone_verified_at").eq("phone_normalized", normalized).maybeSingle();
    if (canonicalError) throw canonicalError;
    if (canonical) return canonical;
    const { data, error } = await supabase.from("users").select("id, fullname, email, phone, phone_normalized, phone_verified_at").eq("phone", normalized).maybeSingle();
    if (error) throw error;
    return data || null;
}

async function queueAndSendFollowup({ sourceType, sourceId, user, phone, productName, now }) {
    const normalized = toFonntePhone(phone);
    if (!normalized || !user?.id) return { skipped: true, reason: "registered_user_phone_missing" };
    const createdAt = new Date(now).toISOString();
    const { data: queued, error: queueError } = await supabase.from("wa_marketing_followups").insert([{
        user_id: user.id,
        source_type: sourceType,
        source_id: String(sourceId),
        phone_normalized: normalized,
        product_name: productName,
        scheduled_at: createdAt,
        status: "queued"
    }]).select("id").maybeSingle();
    if (queueError) {
        if (queueError.code === "23505") return { skipped: true, reason: "already_queued" };
        throw queueError;
    }

    const message = buildAbandonedCheckoutMessage({
        name: resolveUserDisplayName({ fullname: user.fullname, email: user.email }),
        productName,
        orderId: sourceId,
        checkoutUrl: `${FRONTEND_URL}/#/orders`
    });
    const result = await sendMarketingMessage(normalized, message);
    const update = result.success
        ? { status: "sent", sent_at: new Date().toISOString(), attempts: 1, updated_at: new Date().toISOString() }
        : { status: "failed", attempts: 1, last_error: String(result.error || result.reason || "gateway_error").slice(0, 500), updated_at: new Date().toISOString() };
    await supabase.from("wa_marketing_followups").update(update).eq("id", queued.id);
    return { ...result, followupId: queued.id };
}

async function runAbandonedCheckoutFollowups({ now = new Date() } = {}) {
    const current = new Date(now);
    const cutoff = new Date(current.getTime() - ABANDONED_CHECKOUT_DELAY_DAYS * 24 * 60 * 60 * 1000).toISOString();
    let processed = 0;
    const failures = [];
    const orderSources = [
        {
            sourceType: "order",
            table: "orders",
            select: "id, user_id, recipient_phone, recipient_name, recipient_email, items, created_at",
            name: (row) => productNameFromOrder(row),
            phone: (row, user) => user?.phone_normalized || user?.phone || row.recipient_phone
        },
        {
            sourceType: "topup_order",
            table: "topup_orders",
            select: "id, user_id, recipient_phone, recipient_email, nama_produk, created_at",
            name: (row) => String(row.nama_produk || "topup kamu").trim(),
            phone: (row, user) => user?.phone_normalized || user?.phone || row.recipient_phone
        }
    ];

    for (const source of orderSources) {
        const { data: rows, error } = await supabase.from(source.table)
            .select(source.select)
            .eq("status", "pending")
            .not("user_id", "is", null)
            .lte("created_at", cutoff)
            .order("created_at", { ascending: true })
            .limit(100);
        if (error) throw error;
        for (const row of rows || []) {
            if (!shouldScheduleAbandonedCheckout({ status: "pending", createdAt: row.created_at, now: current })) continue;
            try {
                const user = await getRegisteredUserById(row.user_id);
                const result = await queueAndSendFollowup({ sourceType: source.sourceType, sourceId: row.id, user, phone: source.phone(row, user), productName: source.name(row), now: current });
                if (!result.skipped) processed += 1;
            } catch (error) {
                failures.push(`${source.sourceType}:${row.id}:${error.message}`);
            }
        }
    }
    return { processed, failures };
}

async function createCampaign(input, createdBy) {
    const payload = assertCampaignInput(input);
    const { data, error } = await supabase.from("wa_marketing_campaigns").insert([{ ...payload, audience_mode: "opted_in", created_by: createdBy || null, status: "queued" }]).select("*").single();
    if (error) throw error;
    return data;
}

async function listCampaigns(limit = 50) {
    const { data, error } = await supabase.from("wa_marketing_campaigns").select("*").order("created_at", { ascending: false }).limit(Math.min(Number(limit) || 50, 100));
    if (error) throw error;
    return data || [];
}

async function listContacts(limit = 100) {
    const { data, error } = await supabase.from("wa_marketing_contacts").select("*").order("last_inbound_at", { ascending: false, nullsFirst: false }).limit(Math.min(Number(limit) || 100, 500));
    if (error) throw error;
    return data || [];
}

async function setContactOptIn(id, marketingOptIn) {
    const optIn = Boolean(marketingOptIn);
    const payload = { marketing_opt_in: optIn, opted_out_at: optIn ? null : new Date().toISOString(), updated_at: new Date().toISOString() };
    const { data, error } = await supabase.from("wa_marketing_contacts").update(payload).eq("id", id).select("*").single();
    if (error) throw error;
    return data;
}

function extractIncomingBody(payload) {
    return String(payload?.body || payload?.message || "").trim();
}

async function handleInboundMessage(payload) {
    const phone = toFonntePhone(String(payload?.phone || ""));
    if (!phone) return { accepted: false, reason: "invalid_phone" };
    const registeredUser = await getRegisteredUserByPhone(phone);
    const contactData = normalizeIncomingContact({ phone, pushName: payload?.pushName, registeredUser });
    if (!contactData) return { accepted: false, reason: "invalid_phone" };
    const body = extractIncomingBody(payload);
    const command = body.toLowerCase();
    const optInUpdate = /^(mulai|start|ikut|subscribe)$/i.test(command) ? { marketing_opt_in: true, opted_out_at: null } : /^(stop|berhenti|unsubscribe|berhenti promo)$/i.test(command) ? { marketing_opt_in: false, opted_out_at: new Date().toISOString() } : {};
    const { data: contact, error: contactError } = await supabase.from("wa_marketing_contacts").upsert([{
        ...contactData,
        ...optInUpdate,
        last_inbound_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    }], { onConflict: "phone_normalized" }).select("id").single();
    if (contactError) throw contactError;

    const { error: messageError } = await supabase.from("wa_marketing_messages").insert([{
        contact_id: contact.id,
        direction: "inbound",
        message_type: payload?.messageType || "text",
        body: body || null,
        provider_message_id: payload?.providerMessageId || null,
        status: "received",
        metadata: { pushName: payload?.pushName || null, timestamp: payload?.timestamp || null }
    }]);
    if (messageError && messageError.code !== "23505") throw messageError;
    return { accepted: true, contactId: contact.id, registeredUserId: registeredUser?.id || null, optedIn: optInUpdate.marketing_opt_in === true, optedOut: optInUpdate.marketing_opt_in === false };
}

async function runDueCampaigns({ now = new Date() } = {}) {
    const { data: campaigns, error } = await supabase.from("wa_marketing_campaigns").select("*").eq("status", "queued").lte("scheduled_at", new Date(now).toISOString()).order("scheduled_at", { ascending: true }).limit(10);
    if (error) throw error;
    const summary = { campaigns: 0, sent: 0, failed: 0, skipped: 0 };
    for (const campaign of campaigns || []) {
        await supabase.from("wa_marketing_campaigns").update({ status: "sending", updated_at: new Date().toISOString() }).eq("id", campaign.id).eq("status", "queued");
        const { data: contacts, error: contactError } = await supabase.from("wa_marketing_contacts").select("*").eq("marketing_opt_in", true).is("opted_out_at", null).not("user_id", "is", null).limit(MAX_CAMPAIGN_RECIPIENTS);
        if (contactError) throw contactError;
        let sentCount = 0;
        let failedCount = 0;
        for (const contact of contacts || []) {
            const allowed = shouldSendCampaignToContact({ marketingOptIn: contact.marketing_opt_in, optedOutAt: contact.opted_out_at, lastSentAt: contact.last_outbound_at, now });
            if (!allowed) { summary.skipped += 1; continue; }
            const { data: recipient, error: recipientError } = await supabase.from("wa_marketing_campaign_recipients").upsert([{ campaign_id: campaign.id, contact_id: contact.id, status: "sending", attempts: 1, updated_at: new Date().toISOString() }], { onConflict: "campaign_id,contact_id" }).select("id").single();
            if (recipientError) { failedCount += 1; continue; }
            const personalizedMessage = personalizeCampaignMessage(campaign.message, contact, campaign.promo_code);
            const result = await sendMarketingMessage(contact.phone_normalized, personalizedMessage, campaign.media_url);
            if (result.success) {
                sentCount += 1;
                await supabase.from("wa_marketing_campaign_recipients").update({ status: "sent", sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", recipient.id);
                await supabase.from("wa_marketing_contacts").update({ last_outbound_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", contact.id);
            } else {
                failedCount += 1;
                await supabase.from("wa_marketing_campaign_recipients").update({ status: "failed", last_error: String(result.error || result.reason || "gateway_error").slice(0, 500), updated_at: new Date().toISOString() }).eq("id", recipient.id);
            }
            await new Promise((resolve) => setTimeout(resolve, CAMPAIGN_THROTTLE_MS));
        }
        await supabase.from("wa_marketing_campaigns").update({ status: failedCount && !sentCount ? "failed" : "sent", sent_count: sentCount, failed_count: failedCount, updated_at: new Date().toISOString() }).eq("id", campaign.id);
        summary.campaigns += 1;
        summary.sent += sentCount;
        summary.failed += failedCount;
    }
    return summary;
}

module.exports = {
    isAllowedMediaUrl,
    assertCampaignInput,
    sendMarketingMessage,
    runAbandonedCheckoutFollowups,
    createCampaign,
    listCampaigns,
    listContacts,
    setContactOptIn,
    handleInboundMessage,
    runDueCampaigns
};
