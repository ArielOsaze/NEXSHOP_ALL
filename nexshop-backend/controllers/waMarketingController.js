"use strict";

const crypto = require("crypto");
const { getWaApiConfig } = require("../config/settings");
const waMarketing = require("../services/waMarketingService");

function isLoopback(req) {
    const address = String(req.socket?.remoteAddress || "").replace(/^::ffff:/, "");
    return address === "127.0.0.1" || address === "::1";
}

function safeSecretEqual(left, right) {
    const a = Buffer.from(String(left || ""));
    const b = Buffer.from(String(right || ""));
    return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function isSchemaMissing(error) {
    const code = String(error?.code || "");
    const message = String(error?.message || "").toLowerCase();
    return code === "42P01" || message.includes("does not exist") || message.includes("schema cache");
}

function setupRequired(res) {
    return res.status(503).json({ success: false, code: "WA_MARKETING_NOT_SETUP", message: "Jalankan migration 018_create_wa_marketing.sql di Supabase SQL Editor terlebih dahulu." });
}

exports.listCampaigns = async (req, res) => {
    try {
        return res.json({ success: true, campaigns: await waMarketing.listCampaigns(req.query.limit) });
    } catch (error) {
        if (isSchemaMissing(error)) return setupRequired(res);
        console.error("WA marketing campaign list error:", error.message);
        return res.status(500).json({ success: false, message: "Gagal memuat campaign WhatsApp." });
    }
};

exports.createCampaign = async (req, res) => {
    try {
        const campaign = await waMarketing.createCampaign(req.body, req.user.id);
        return res.status(201).json({ success: true, campaign });
    } catch (error) {
        if (isSchemaMissing(error)) return setupRequired(res);
        return res.status(400).json({ success: false, message: error.message || "Campaign tidak valid." });
    }
};

exports.listContacts = async (req, res) => {
    try {
        return res.json({ success: true, contacts: await waMarketing.listContacts(req.query.limit) });
    } catch (error) {
        if (isSchemaMissing(error)) return setupRequired(res);
        console.error("WA marketing contact list error:", error.message);
        return res.status(500).json({ success: false, message: "Gagal memuat daftar kontak WhatsApp." });
    }
};

exports.updateContactOptIn = async (req, res) => {
    try {
        const contact = await waMarketing.setContactOptIn(req.params.id, req.body?.marketing_opt_in);
        return res.json({ success: true, contact });
    } catch (error) {
        if (isSchemaMissing(error)) return setupRequired(res);
        console.error("WA marketing contact opt-in error:", error.message);
        return res.status(400).json({ success: false, message: "Gagal mengubah izin promo kontak." });
    }
};

exports.runNow = async (req, res) => {
    try {
        const [followups, campaigns] = await Promise.all([
            waMarketing.runAbandonedCheckoutFollowups(),
            waMarketing.runDueCampaigns()
        ]);
        return res.json({ success: true, followups, campaigns });
    } catch (error) {
        if (isSchemaMissing(error)) return setupRequired(res);
        console.error("WA marketing manual run error:", error.message);
        return res.status(500).json({ success: false, message: "Gagal menjalankan queue WhatsApp." });
    }
};

exports.receiveInbound = async (req, res) => {
    if (!isLoopback(req) || req.get("X-NexShop-WA-Gateway") !== "loopback") {
        return res.status(403).json({ success: false, message: "Inbound WhatsApp hanya boleh dari gateway lokal." });
    }
    try {
        const { key } = await getWaApiConfig({ fresh: true });
        if (!safeSecretEqual(req.get("X-WA-Gateway-Key"), key)) {
            return res.status(401).json({ success: false, message: "Inbound gateway tidak terautentikasi." });
        }
        const result = await waMarketing.handleInboundMessage(req.body || {});
        return res.status(result.accepted ? 202 : 400).json({ success: result.accepted, ...result });
    } catch (error) {
        if (isSchemaMissing(error)) return setupRequired(res);
        console.error("WA inbound message error:", error.message);
        return res.status(500).json({ success: false, message: "Gagal menyimpan chat WhatsApp." });
    }
};
