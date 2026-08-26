require("dotenv").config();

const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const express = require("express");
const QRCode = require("qrcode");
const P = require("pino");

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "127.0.0.1";
const API_KEY = String(process.env.WA_API_KEY || "").trim();
const MAX_MESSAGE_LENGTH = Number(process.env.MAX_MESSAGE_LENGTH || 4096);
const AUTH_DIR = path.resolve(process.env.WA_AUTH_DIR || path.join(__dirname, "data", "auth_info"));

if (!API_KEY || API_KEY.length < 24) {
    throw new Error("WA_API_KEY wajib diisi dan minimal 24 karakter. Jangan gunakan key bawaan.");
}
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    throw new Error("PORT WA gateway tidak valid.");
}
if (!Number.isInteger(MAX_MESSAGE_LENGTH) || MAX_MESSAGE_LENGTH < 100 || MAX_MESSAGE_LENGTH > 10000) {
    throw new Error("MAX_MESSAGE_LENGTH harus berada antara 100 dan 10000.");
}

const logger = P({ level: process.env.LOG_LEVEL || "info" });
let socket = null;
let connectionState = "starting";
let latestQr = null;
let latestQrImage = null;
let reconnectTimer = null;
let connecting = false;
let shuttingDown = false;

function apiKeyMatches(candidate) {
    const supplied = Buffer.from(String(candidate || ""));
    const expected = Buffer.from(API_KEY);
    return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

function requireApiKey(req, res, next) {
    if (!apiKeyMatches(req.get("X-API-Key"))) {
        return res.status(401).json({ success: false, message: "API key tidak valid." });
    }
    next();
}

function normalizeIndonesianPhone(rawPhone) {
    const value = String(rawPhone || "").trim();
    if (!value || /[^0-9+\s().-]/.test(value)) return "";
    const compact = value.replace(/[\s().-]/g, "");
    let national = "";
    if (/^08\d{7,12}$/.test(compact)) national = compact.slice(1);
    else if (/^8\d{7,12}$/.test(compact)) national = compact;
    else if (/^628\d{7,12}$/.test(compact)) national = compact.slice(2);
    else if (/^\+628\d{7,12}$/.test(compact)) national = compact.slice(3);
    return national ? `62${national}` : "";
}

function messageFromOtp({ otp, message }) {
    if (typeof message === "string" && message.trim()) return message.trim();
    if (!/^\d{4,10}$/.test(String(otp || ""))) return "";
    return `Kode OTP NexShop kamu adalah: *${otp}*\n\nKode ini berlaku selama 10 menit. Jangan berikan kode ini kepada siapa pun.`;
}

function messageFromTransaction({ orderId, status, amount, message }) {
    if (typeof message === "string" && message.trim()) return message.trim();
    if (!orderId || !["pending", "success", "failed"].includes(status)) return "";
    const label = status === "pending"
        ? "sedang menunggu pembayaran"
        : status === "success"
            ? "berhasil diproses"
            : "belum dapat diproses";
    return `Pesanan NexShop #${orderId} ${label}.${amount ? `\nTotal: ${amount}` : ""}`;
}

async function loadBaileys() {
    // Baileys v7 is ESM-first. Dynamic import keeps this small gateway CommonJS.
    return import("@whiskeysockets/baileys");
}

function clearQr() {
    latestQr = null;
    latestQrImage = null;
}

function scheduleReconnect(delayMs = 3000) {
    if (shuttingDown || reconnectTimer || connectionState === "connected") return;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect().catch((error) => logger.error({ err: error.message }, "WA reconnect gagal"));
    }, delayMs);
}

async function connect() {
    if (connecting || shuttingDown) return;
    connecting = true;
    connectionState = "connecting";

    try {
        const baileys = await loadBaileys();
        const makeWASocket = baileys.default;
        const { DisconnectReason, useMultiFileAuthState, makeCacheableSignalKeyStore } = baileys;
        const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
        const sock = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger)
            },
            logger,
            markOnlineOnConnect: false,
            syncFullHistory: false,
            shouldIgnoreJid: () => false
        });
        socket = sock;
        sock.ev.on("creds.update", saveCreds);
        sock.ev.on("connection.update", async (update) => {
            // Event dari socket lama dapat tiba setelah reset/reconnect. Jangan
            // biarkan ia menimpa status socket yang lebih baru.
            if (socket !== sock) return;
            const { connection, lastDisconnect, qr } = update;
            if (qr) {
                latestQr = qr;
                latestQrImage = await QRCode.toDataURL(qr, { margin: 1, width: 360 });
                connectionState = "qr";
                logger.info("QR WhatsApp baru tersedia; scan dari Admin NexShop.");
            }
            if (connection === "open") {
                clearQr();
                connectionState = "connected";
                logger.info("WhatsApp gateway terhubung.");
            }
            if (connection === "close") {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                socket = null;
                connectionState = "disconnected";
                const loggedOut = statusCode === DisconnectReason.loggedOut;
                logger.warn({ statusCode, loggedOut }, "Koneksi WhatsApp tertutup.");
                if (!loggedOut) scheduleReconnect();
            }
        });
    } finally {
        connecting = false;
    }
}

async function sendMessage(phone, message) {
    if (!socket || connectionState !== "connected") {
        const error = new Error("WhatsApp belum terhubung. Scan QR terlebih dahulu.");
        error.code = "WA_NOT_CONNECTED";
        throw error;
    }
    const result = await socket.sendMessage(`${phone}@s.whatsapp.net`, { text: message });
    return { id: result?.key?.id || null };
}

async function resetSession() {
    shuttingDown = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    try {
        if (socket?.end) socket.end(new Error("Sesi direset administrator"));
    } catch (_) {
        // Socket can already be closed; deleting its persisted credential is enough.
    }
    socket = null;
    clearQr();
    await fs.rm(AUTH_DIR, { recursive: true, force: true });
    shuttingDown = false;
    connectionState = "starting";
    await connect();
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));
app.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
});

app.get("/health", requireApiKey, (req, res) => {
    res.json({
        success: true,
        service: "nexshop-wa-api",
        waConnected: connectionState === "connected",
        qrAvailable: Boolean(latestQr),
        state: connectionState
    });
});

app.get("/qr", requireApiKey, (req, res) => {
    res.json({ success: true, qr: latestQr, qrImage: latestQrImage, waConnected: connectionState === "connected" });
});

app.post("/send-otp", requireApiKey, async (req, res) => {
    const phone = normalizeIndonesianPhone(req.body?.phone);
    const message = messageFromOtp(req.body || {});
    if (!phone) return res.status(400).json({ success: false, message: "Nomor WhatsApp Indonesia tidak valid." });
    if (!message || message.length > MAX_MESSAGE_LENGTH) return res.status(400).json({ success: false, message: "Pesan OTP tidak valid atau terlalu panjang." });
    try {
        const sent = await sendMessage(phone, message);
        res.json({ success: true, message: "Pesan OTP diterima gateway.", messageId: sent.id });
    } catch (error) {
        res.status(error.code === "WA_NOT_CONNECTED" ? 503 : 502).json({ success: false, message: error.message });
    }
});

app.post("/send-transaction", requireApiKey, async (req, res) => {
    const phone = normalizeIndonesianPhone(req.body?.phone);
    const message = messageFromTransaction(req.body || {});
    if (!phone) return res.status(400).json({ success: false, message: "Nomor WhatsApp Indonesia tidak valid." });
    if (!message || message.length > MAX_MESSAGE_LENGTH) return res.status(400).json({ success: false, message: "Data transaksi/pesan tidak valid." });
    try {
        const sent = await sendMessage(phone, message);
        res.json({ success: true, message: "Notifikasi transaksi diterima gateway.", messageId: sent.id });
    } catch (error) {
        res.status(error.code === "WA_NOT_CONNECTED" ? 503 : 502).json({ success: false, message: error.message });
    }
});

app.post("/send-message", requireApiKey, async (req, res) => {
    const phone = normalizeIndonesianPhone(req.body?.phone);
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!phone) return res.status(400).json({ success: false, message: "Nomor WhatsApp Indonesia tidak valid." });
    if (!message || message.length > MAX_MESSAGE_LENGTH) return res.status(400).json({ success: false, message: "Pesan wajib diisi dan maksimal sesuai batas gateway." });
    try {
        const sent = await sendMessage(phone, message);
        res.json({ success: true, message: "Pesan diterima gateway.", messageId: sent.id });
    } catch (error) {
        res.status(error.code === "WA_NOT_CONNECTED" ? 503 : 502).json({ success: false, message: error.message });
    }
});

app.post("/reset", requireApiKey, async (req, res) => {
    try {
        await resetSession();
        res.status(202).json({ success: true, message: "Sesi WhatsApp dihapus. QR baru akan tersedia sesaat lagi." });
    } catch (error) {
        logger.error({ err: error.message }, "Reset sesi WhatsApp gagal");
        res.status(500).json({ success: false, message: "Gagal mereset sesi WhatsApp." });
    }
});

app.use((error, req, res, next) => {
    logger.error({ err: error.message }, "Gateway request error");
    res.status(400).json({ success: false, message: "Request gateway tidak valid." });
});

const server = app.listen(PORT, HOST, () => {
    logger.info({ host: HOST, port: PORT }, "NexShop WA gateway berjalan");
    connect().catch((error) => logger.error({ err: error.message }, "WA gateway gagal memulai koneksi"));
});

async function shutdown() {
    shuttingDown = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    try { if (socket?.end) socket.end(new Error("Gateway dihentikan")); } catch (_) {}
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
