"use strict";

const { toFonntePhone } = require("../utils/phoneNumber");

const ABANDONED_CHECKOUT_DELAY_DAYS = 7;
const DEFAULT_CAMPAIGN_COOLDOWN_HOURS = 24;
const ABANDONED_FOLLOWUP_COOLDOWN_DAYS = 7;

function validDate(value) {
    const date = value instanceof Date ? value : new Date(value || 0);
    return Number.isNaN(date.getTime()) ? null : date;
}

function shouldScheduleAbandonedCheckout({ status, createdAt, reminderSentAt, now = new Date() }) {
    if (String(status || "").toLowerCase() !== "pending") return false;
    if (reminderSentAt) return false;
    const created = validDate(createdAt);
    const current = validDate(now);
    if (!created || !current || created > current) return false;
    const delayMs = ABANDONED_CHECKOUT_DELAY_DAYS * 24 * 60 * 60 * 1000;
    return current.getTime() - created.getTime() >= delayMs;
}

function buildAbandonedCheckoutMessage({ name, productName, orderId, checkoutUrl }) {
    const safeName = String(name || "Pengguna NexShop").trim();
    const safeProduct = String(productName || "pesanan kamu").trim();
    const safeOrderId = String(orderId || "-").trim();
    const safeUrl = String(checkoutUrl || "https://nexshop.cloud/").trim();
    return [
        `Halo ${safeName} 👋`,
        "",
        `Kamu masih punya checkout yang belum selesai: *${safeProduct}*.`,
        `Order: ${safeOrderId}`,
        "",
        "Kalau masih ingin, yuk lanjutkan checkout sebelum stok atau harga berubah.",
        safeUrl,
        "",
        "Kalau sudah tidak berminat, abaikan pesan ini ya."
    ].join("\n");
}

function shouldSendCampaignToContact({ marketingOptIn, optedOutAt, lastSentAt, now = new Date(), cooldownHours = DEFAULT_CAMPAIGN_COOLDOWN_HOURS }) {
    if (!marketingOptIn || optedOutAt) return false;
    if (!lastSentAt) return true;
    const current = validDate(now);
    const last = validDate(lastSentAt);
    if (!current || !last || last > current) return false;
    return current.getTime() - last.getTime() >= Number(cooldownHours) * 60 * 60 * 1000;
}

function normalizeIncomingContact({ phone, pushName, registeredUser }) {
    const phoneNormalized = toFonntePhone(String(phone || ""));
    if (!phoneNormalized) return null;
    const fullname = String(registeredUser?.fullname || "").trim();
    const email = String(registeredUser?.email || "").trim();
    const displayName = fullname || String(pushName || "").trim() || (email ? email.split("@")[0] : "Kontak WhatsApp");
    return {
        user_id: registeredUser?.id || null,
        phone_normalized: phoneNormalized,
        display_name: displayName,
        email: email || null
    };
}

function pickLatestAbandonedCheckoutRows(rows) {
    const latestByUser = new Map();
    for (const row of rows || []) {
        const userKey = String(row?.user_id || "");
        if (!userKey) continue;
        const existing = latestByUser.get(userKey);
        if (!existing || new Date(row.created_at).getTime() > new Date(existing.created_at).getTime()) {
            latestByUser.set(userKey, row);
        }
    }
    return [...latestByUser.values()].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

function hasRecentAbandonedFollowup({ followups = [], now = new Date(), cooldownDays = ABANDONED_FOLLOWUP_COOLDOWN_DAYS } = {}) {
    const cutoff = new Date(new Date(now).getTime() - Number(cooldownDays) * 24 * 60 * 60 * 1000).getTime();
    return (followups || []).some((followup) => {
        if (!["queued", "sending", "sent"].includes(followup?.status)) return false;
        const createdAt = new Date(followup?.created_at || 0).getTime();
        return Number.isFinite(createdAt) && createdAt >= cutoff;
    });
}

function personalizeCampaignMessage(template, contact, promoCode = "") {
    return String(template || "")
        .replace(/\{name\}/g, String(contact?.display_name || "Pengguna NexShop"))
        .replace(/\{promo_code\}/g, String(promoCode || ""));
}

module.exports = {
    ABANDONED_CHECKOUT_DELAY_DAYS,
    ABANDONED_FOLLOWUP_COOLDOWN_DAYS,
    DEFAULT_CAMPAIGN_COOLDOWN_HOURS,
    shouldScheduleAbandonedCheckout,
    buildAbandonedCheckoutMessage,
    shouldSendCampaignToContact,
    normalizeIncomingContact,
    personalizeCampaignMessage,
    pickLatestAbandonedCheckoutRows,
    hasRecentAbandonedFollowup
};
