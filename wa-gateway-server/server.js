require("dotenv").config();

const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const express = require("express");
const QRCode = require("qrcode");
const P = require("pino");
const { createRuntimeConfigStore, normalizeApiKey } = require("./runtimeConfig");

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "127.0.0.1";
const ENV_API_KEY = String(process.env.WA_API_KEY || "").trim(); // kompatibilitas migrasi lama saja
const MAX_MESSAGE_LENGTH = Number(process.env.MAX_MESSAGE_LENGTH || 4096);
const INBOUND_WEBHOOK_URL = String(process.env.INBOUND_WEBHOOK_URL || "http://127.0.0.1:3000/api/wa-marketing/inbound").trim();
const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
const AUTH_DIR = path.resolve(process.env.WA_AUTH_DIR || path.join(__dirname, "data", "auth_info"));
const RUNTIME_CONFIG_PATH = path.resolve(process.env.WA_RUNTIME_CONFIG || path.join(path.dirname(AUTH_DIR), "gateway-config.json"));
const configStore = createRuntimeConfigStore({ configPath: RUNTIME_CONFIG_PATH });

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    throw new Error("PORT WA gateway tidak valid.");
}
if (!Number.isInteger(MAX_MESSAGE_LENGTH) || MAX_MESSAGE_LENGTH < 100 || MAX_MESSAGE_LENGTH > 10000) {
    throw new Error("MAX_MESSAGE_LENGTH harus berada antara 100 dan 10000.");
}

const logger = P({ level: process.env.LOG_LEVEL || "info" });
let apiKey = "";
let socket = null;
let connectionState = "starting";
let latestQr = null;
let latestQrImage = null;
let reconnectTimer = null;
let connecting = false;
let shuttingDown = false;

function apiKeyMatches(candidate) {
    if (!apiKey) return false;
    const supplied = Buffer.from(String(candidate || ""));
    const expected = Buffer.from(apiKey);
    return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

function isLoopbackRequest(req) {
    const address = String(req.socket?.remoteAddress || "").replace(/^::ffff:/, "");
    return address === "127.0.0.1" || address === "::1";
}

function requireLocalBackend(req, res, next) {
    if (!isLoopbackRequest(req)) {
        return res.status(403).json({ success: false, message: "Provisioning gateway hanya boleh dari backend lokal VPS." });
    }
    next();
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

function isAllowedMediaUrl(rawUrl) {
    try {
        const parsed = new URL(String(rawUrl || ""));
        const hostname = parsed.hostname.toLowerCase();
        return ["https:", "http:"].includes(parsed.protocol)
            && !parsed.username && !parsed.password
            && !["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(hostname)
            && !hostname.endsWith(".local");
    } catch (_) {
        return false;
    }
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
        sock.ev.on("messages.upsert", ({ messages }) => {
            for (const message of messages || []) {
                relayIncomingMessage(message).catch((error) => logger.warn({ err: error.message }, "Relay chat inbound gagal"));
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

async function sendMediaMessage(phone, mediaUrl, caption) {
    if (!socket || connectionState !== "connected") {
        const error = new Error("WhatsApp belum terhubung. Scan QR terlebih dahulu.");
        error.code = "WA_NOT_CONNECTED";
        throw error;
    }
    if (!isAllowedMediaUrl(mediaUrl)) throw new Error("URL media tidak valid atau mengarah ke host lokal.");
    const response = await fetch(mediaUrl, { redirect: "error" });
    if (!response.ok) throw new Error(`Media tidak dapat diunduh (HTTP ${response.status}).`);
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.startsWith("image/")) throw new Error("Media campaign harus berupa gambar.");
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > MAX_MEDIA_BYTES) throw new Error("Ukuran gambar maksimal 8 MB.");
    const result = await socket.sendMessage(`${phone}@s.whatsapp.net`, { image: buffer, caption: String(caption || "").slice(0, MAX_MESSAGE_LENGTH) });
    return { id: result?.key?.id || null };
}

function extractIncomingText(message) {
    const content = message?.message || {};
    return String(content.conversation || content.extendedTextMessage?.text || content.imageMessage?.caption || content.videoMessage?.caption || content.documentMessage?.caption || "").trim();
}

function extractIncomingType(message) {
    const content = message?.message || {};
    if (content.imageMessage) return "image";
    if (content.videoMessage) return "video";
    if (content.documentMessage) return "document";
    return "text";
}

async function relayIncomingMessage(message) {
    const jid = String(message?.key?.remoteJid || "");
    if (message?.key?.fromMe || !jid.endsWith("@s.whatsapp.net")) return;
    const phone = jid.slice(0, -"@s.whatsapp.net".length);
    if (!/^62\d{8,15}$/.test(phone) || !INBOUND_WEBHOOK_URL) return;
    const response = await fetch(INBOUND_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-NexShop-WA-Gateway": "loopback", "X-WA-Gateway-Key": apiKey },
        body: JSON.stringify({
            phone,
            pushName: message.pushName || "",
            body: extractIncomingText(message),
            messageType: extractIncomingType(message),
            providerMessageId: message?.key?.id || null,
            timestamp: message?.messageTimestamp ? String(message.messageTimestamp) : null
        })
    });
    if (!response.ok) throw new Error(`Backend inbound menolak HTTP ${response.status}`);
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

// Endpoint bootstrap ini tidak memakai API key karena ia dipakai untuk membuat
// key pertama. Ia aman karena gateway default bind 127.0.0.1 dan request harus
// benar-benar berasal dari socket loopback (backend NexShop di VPS yang sama).
app.post("/internal/configure", requireLocalBackend, async (req, res) => {
    try {
        const nextKey = normalizeApiKey(req.body?.apiKey);
        await configStore.setApiKey(nextKey);
        apiKey = nextKey;
        logger.info({ configPath: configStore.getConfigPath() }, "WA gateway dikonfigurasi dari Admin NexShop");
        res.json({ success: true, message: "Key WA gateway tersimpan di runtime data VPS." });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message || "Konfigurasi gateway tidak valid." });
    }
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

app.post("/send-media", requireApiKey, async (req, res) => {
    const phone = normalizeIndonesianPhone(req.body?.phone);
    const mediaUrl = typeof req.body?.mediaUrl === "string" ? req.body.mediaUrl.trim() : "";
    const caption = typeof req.body?.caption === "string" ? req.body.caption.trim() : "";
    if (!phone) return res.status(400).json({ success: false, message: "Nomor WhatsApp Indonesia tidak valid." });
    if (!mediaUrl || mediaUrl.length > 2048 || caption.length > MAX_MESSAGE_LENGTH) return res.status(400).json({ success: false, message: "URL foto atau caption tidak valid." });
    try {
        const sent = await sendMediaMessage(phone, mediaUrl, caption);
        res.json({ success: true, message: "Foto diterima gateway.", messageId: sent.id });
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

let server = null;

async function initializeGatewayConfig() {
    await configStore.load();
    apiKey = configStore.getApiKey();
    // Migrasi sekali dari deploy lama yang sudah punya WA_API_KEY di .env.
    // Setelah tersimpan, key berikutnya dikelola Dashboard dan .env tidak perlu disentuh lagi.
    if (!apiKey && ENV_API_KEY) {
        try {
            await configStore.setApiKey(ENV_API_KEY);
            apiKey = configStore.getApiKey();
            logger.info({ configPath: configStore.getConfigPath() }, "WA_API_KEY lama dimigrasikan ke runtime config");
        } catch (error) {
            logger.warn({ err: error.message }, "WA_API_KEY .env tidak valid; tunggu provisioning dari Dashboard");
        }
    }
    if (!apiKey) logger.warn("Gateway belum diprovision. Admin NexShop dapat membuat key dari Settings > API Keys.");
}

async function startGateway() {
    await initializeGatewayConfig();
    server = app.listen(PORT, HOST, () => {
        logger.info({ host: HOST, port: PORT }, "NexShop WA gateway berjalan");
        connect().catch((error) => logger.error({ err: error.message }, "WA gateway gagal memulai koneksi"));
    });
}

startGateway().catch((error) => {
    logger.fatal({ err: error.message }, "WA gateway gagal memulai");
    process.exit(1);
});

async function shutdown() {
    shuttingDown = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    try { if (socket?.end) socket.end(new Error("Gateway dihentikan")); } catch (_) {}
    if (!server) return process.exit(0);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
