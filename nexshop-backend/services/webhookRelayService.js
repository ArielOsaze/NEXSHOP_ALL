// ===========================================================
// WEBHOOK RELAY NEXSHOP
//
// TokoVoucher cuma nyediain SATU slot URL callback per akun member, dan slot
// itu kepake buat NexShop sendiri. Toko/reseller lain yang transaksinya
// nebeng akun TokoVoucher NexShop jadi gak punya jalan nerima notifikasi
// status transaksinya.
//
// Modul ini bikin NexShop jadi relay: callback asli masuk sekali ke
// /api/topup/tokovoucher-webhook, diproses seperti biasa, lalu payload-nya
// DITERUSKAN ke daftar URL yang didaftarin admin (tabel webhook_endpoints).
//
// Aturan main yang dipegang di sini:
//  1. Pengiriman TIDAK pernah nyangkutin request webhook aslinya. TokoVoucher
//     harus tetap dapat 200 secepat mungkin, kalau enggak mereka retry terus.
//  2. Gagal kirim itu WAJAR (server toko lagi mati). Makanya tiap pengiriman
//     dicatat sebagai baris antrean dan di-retry berjenjang oleh
//     jobs/webhookRelayPoller.js.
//  3. URL tujuan datang dari input admin, jadi diperlakukan sebagai alamat
//     yang gak dipercaya -- lihat assertSafeTargetUrl() (proteksi SSRF).
// ===========================================================

const crypto = require("crypto");
const dns = require("dns").promises;
const net = require("net");
const axios = require("axios");
const supabase = require("../config/db");

const RELAY_NOT_SETUP_CODE = "WEBHOOK_RELAY_NOT_SETUP";
const RELAY_NOT_SETUP_MESSAGE = "Fitur Webhook Relay saat ini sedang tidak tersedia.";

// Jadwal retry (menit) per percobaan yang sudah gagal. Panjangnya sekaligus
// nentuin jatah percobaan: habis ini statusnya jadi "dead".
const RETRY_SCHEDULE_MINUTES = [1, 5, 15, 60, 180];
const MAX_ATTEMPTS = RETRY_SCHEDULE_MINUTES.length + 1;

const DELIVERY_TIMEOUT_MS = 10000;
const MAX_RESPONSE_SNIPPET = 500;

// ===========================================================
// Deteksi "migration belum dijalankan"
//
// Sama polanya kayak fitur reseller: selama tabelnya belum ada, semua
// endpoint balas 503 yang ramah, bukan 500 mentah.
// ===========================================================
function isRelayMissing(error) {
    if (!error) return false;
    const code = String(error.code || "");
    const message = String(error.message || "").toLowerCase();
    return (
        code === "42P01" ||
        code === "PGRST205" ||
        (message.includes("webhook_endpoints") && message.includes("does not exist")) ||
        (message.includes("webhook_deliveries") && message.includes("does not exist")) ||
        (message.includes("could not find the table") && message.includes("webhook_"))
    );
}

class RelayNotSetupError extends Error {
    constructor() {
        super(RELAY_NOT_SETUP_MESSAGE);
        this.name = "RelayNotSetupError";
        this.code = RELAY_NOT_SETUP_CODE;
        this.status = 503;
    }
}

function throwIfMissing(error) {
    if (isRelayMissing(error)) throw new RelayNotSetupError();
}

// ===========================================================
// Keamanan URL tujuan (anti-SSRF)
//
// URL-nya diisi manual oleh admin, tapi tetap dianggap gak dipercaya: kalau
// suatu saat akun admin kebobol, "webhook" bisa dipakai buat maksa server
// kita nembak alamat internal (metadata cloud, Redis lokal, dashboard admin
// yang cuma kebuka dari localhost). Jadi hostname-nya di-resolve dulu dan
// alamat privat ditolak.
//
// Buat testing lokal, set WEBHOOK_RELAY_ALLOW_PRIVATE=1.
// ===========================================================
const ALLOW_PRIVATE = process.env.WEBHOOK_RELAY_ALLOW_PRIVATE === "1";

function isPrivateIp(ip) {
    if (net.isIPv4(ip)) {
        const [a, b] = ip.split(".").map(Number);
        if (a === 10) return true;
        if (a === 127) return true;
        if (a === 0) return true;
        if (a === 169 && b === 254) return true; // link-local + metadata cloud
        if (a === 172 && b >= 16 && b <= 31) return true;
        if (a === 192 && b === 168) return true;
        if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
        return false;
    }
    if (net.isIPv6(ip)) {
        const low = ip.toLowerCase();
        if (low === "::1" || low === "::") return true;
        if (low.startsWith("fe80") || low.startsWith("fc") || low.startsWith("fd")) return true;
        // IPv4-mapped (::ffff:127.0.0.1) -- cek bagian IPv4-nya
        const mapped = low.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
        if (mapped) return isPrivateIp(mapped[1]);
        return false;
    }
    return false;
}

async function assertSafeTargetUrl(rawUrl) {
    let url;
    try {
        url = new URL(String(rawUrl || "").trim());
    } catch {
        const err = new Error("URL webhook tidak valid.");
        err.status = 400;
        throw err;
    }

    if (url.protocol !== "https:" && url.protocol !== "http:") {
        const err = new Error("URL webhook harus diawali http:// atau https://");
        err.status = 400;
        throw err;
    }
    if (url.protocol === "http:" && !ALLOW_PRIVATE) {
        const err = new Error("URL webhook wajib HTTPS (http:// cuma boleh saat development).");
        err.status = 400;
        throw err;
    }

    if (ALLOW_PRIVATE) return url.toString();

    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) {
        const err = new Error("URL webhook tidak boleh mengarah ke alamat internal.");
        err.status = 400;
        throw err;
    }

    // Kalau host-nya sudah berupa IP, cek langsung. Kalau nama domain,
    // resolve dulu -- domain publik gampang diarahin ke 127.0.0.1.
    const literals = net.isIP(host) ? [host] : [];
    if (!literals.length) {
        try {
            const records = await dns.lookup(host, { all: true });
            literals.push(...records.map((r) => r.address));
        } catch {
            const err = new Error("Domain URL webhook tidak bisa di-resolve. Cek lagi alamatnya.");
            err.status = 400;
            throw err;
        }
    }

    if (literals.some(isPrivateIp)) {
        const err = new Error("URL webhook mengarah ke alamat jaringan internal dan ditolak.");
        err.status = 400;
        throw err;
    }

    return url.toString();
}

// ===========================================================
// Signature keluar
//
// Penerima memverifikasi dengan:
//   HMAC_SHA256(secret, timestamp + "." + rawBody) == signature
// Timestamp ikut ditandatangani supaya payload lama gak bisa diputar ulang
// (replay) oleh pihak ketiga yang sempat nyadap satu request.
// ===========================================================
function signPayload(secret, timestamp, rawBody) {
    return crypto.createHmac("sha256", secret).update(timestamp + "." + rawBody).digest("hex");
}

function generateSecret() {
    return "whsec_" + crypto.randomBytes(24).toString("hex");
}

// ===========================================================
// Routing: endpoint mana yang berhak nerima callback dengan ref_id ini
// ===========================================================
function endpointMatchesRef(endpoint, refId) {
    if (endpoint.forward_all) return true;
    const prefix = String(endpoint.ref_prefix || "").trim();
    if (!prefix) return false;
    return String(refId || "").startsWith(prefix);
}

async function listActiveEndpoints() {
    const { data, error } = await supabase
        .from("webhook_endpoints")
        .select("*")
        .eq("is_active", true);
    if (error) {
        throwIfMissing(error);
        throw error;
    }
    return data || [];
}

// ===========================================================
// ENQUEUE — dipanggil dari handler webhook TokoVoucher.
//
// SENGAJA gak pernah nge-throw ke pemanggil: relay gagal antre pun, order
// NexShop sendiri sudah beres diproses dan TokoVoucher tetap harus dapat 200.
// ===========================================================
async function enqueueTokoVoucherRelay(payload, originalSignature = null) {
    try {
        const refId = payload && payload.ref_id ? String(payload.ref_id) : null;
        const endpoints = await listActiveEndpoints();
        const targets = endpoints.filter((ep) => endpointMatchesRef(ep, refId));
        if (!targets.length) return { queued: 0 };

        const rawStatus = payload && (payload.status !== undefined && payload.status !== null)
            ? payload.status
            : (payload && payload.status_message) || "";
        const trxStatus = String(rawStatus).slice(0, 40);

        const rows = targets.map((ep) => ({
            endpoint_id: ep.id,
            event: "tokovoucher.transaction",
            ref_id: refId,
            payload: {
                // Payload asli TokoVoucher diteruskan apa adanya di "data"
                // supaya penerima gak perlu nebak-nebak bentuknya, plus
                // amplop kecil biar mereka tahu ini datang lewat relay.
                source: "tokovoucher",
                relayed_by: "nexshop",
                received_at: new Date().toISOString(),
                // Cuma dipakai kalau endpoint-nya minta signature asli
                // diteruskan (forward_original_signature).
                original_signature: ep.forward_original_signature ? originalSignature : undefined,
                data: payload
            },
            dedup_key: refId ? refId + ":" + trxStatus : null,
            status: "pending",
            attempt_count: 0
        }));

        // Duplikat (ref_id + status yang persis sama) ditolak unique index dan
        // itu memang yang diharapkan, bukan error yang perlu diributin.
        const { data, error } = await supabase
            .from("webhook_deliveries")
            .upsert(rows, { onConflict: "endpoint_id,dedup_key", ignoreDuplicates: true })
            .select("id");

        if (error) {
            throwIfMissing(error);
            throw error;
        }

        const queued = (data || []).length;
        if (queued > 0) {
            // Jangan di-await: request webhook TokoVoucher harus balik cepat.
            setImmediate(() => {
                flushPendingDeliveries().catch((err) =>
                    console.log("[webhook-relay] gagal kirim langsung:", err.message)
                );
            });
        }
        return { queued };
    } catch (err) {
        if (err instanceof RelayNotSetupError) return { queued: 0, notSetup: true };
        console.log("[webhook-relay] gagal antre relay:", err.message);
        return { queued: 0, error: err.message };
    }
}

// ===========================================================
// PENGIRIMAN
// ===========================================================
function schedulePatchAfterFailure(attemptCount, errorMessage, responseStatus, responseBody, event) {
    const nextDelay = RETRY_SCHEDULE_MINUTES[attemptCount - 1];
    // Payload uji dari tombol "Tes Kirim" cuma dicoba SEKALI. Admin lagi
    // berdiri di depan dashboard nunggu hasilnya; kalau ikut dijadwal
    // retry, dia bakal nembak server toko berjam-jam setelahnya tanpa ada
    // yang minta.
    const sekaliJalan = event === "nexshop.test";
    const isDead = sekaliJalan || attemptCount >= MAX_ATTEMPTS || nextDelay === undefined;
    return {
        status: isDead ? "dead" : "failed",
        attempt_count: attemptCount,
        next_retry_at: isDead ? null : new Date(Date.now() + nextDelay * 60000).toISOString(),
        last_error: String(errorMessage || "").slice(0, MAX_RESPONSE_SNIPPET),
        response_status: responseStatus === undefined ? null : responseStatus,
        response_body: responseBody ? String(responseBody).slice(0, MAX_RESPONSE_SNIPPET) : null,
        locked_at: null,
        lock_token: null,
        updated_at: new Date().toISOString()
    };
}

async function bumpEndpointStats(endpointId, ok) {
    // Statistik ringan buat dashboard. Kalau gagal, diamkan -- angka counter
    // gak sepadan sama risiko bikin pengiriman ikut dianggap gagal.
    try {
        const { data } = await supabase
            .from("webhook_endpoints")
            .select("total_delivered, total_failed")
            .eq("id", endpointId)
            .maybeSingle();
        if (!data) return;
        await supabase
            .from("webhook_endpoints")
            .update({
                total_delivered: (data.total_delivered || 0) + (ok ? 1 : 0),
                total_failed: (data.total_failed || 0) + (ok ? 0 : 1),
                last_delivery_at: new Date().toISOString(),
                last_status: ok ? "success" : "failed",
                updated_at: new Date().toISOString()
            })
            .eq("id", endpointId);
    } catch (err) {
        /* diabaikan sengaja -- statistik bukan data kritis */
    }
}

async function sendDelivery(delivery, endpoint) {
    const attemptCount = (delivery.attempt_count || 0) + 1;
    const rawBody = JSON.stringify(delivery.payload);
    const timestamp = Math.floor(Date.now() / 1000).toString();

    try {
        const safeUrl = await assertSafeTargetUrl(endpoint.target_url);

        const headers = {
            "Content-Type": "application/json",
            "User-Agent": "NexShop-Webhook-Relay/1.0",
            "X-NexShop-Event": delivery.event,
            "X-NexShop-Delivery": delivery.id,
            "X-NexShop-Timestamp": timestamp,
            "X-NexShop-Attempt": String(attemptCount),
            "X-NexShop-Signature": "sha256=" + signPayload(endpoint.secret, timestamp, rawBody)
        };
        if (endpoint.forward_original_signature && delivery.payload && delivery.payload.original_signature) {
            headers["X-TokoVoucher-Authorization"] = delivery.payload.original_signature;
        }

        const res = await axios.post(safeUrl, rawBody, {
            headers,
            timeout: DELIVERY_TIMEOUT_MS,
            // Status apa pun ditangani sendiri di bawah, bukan lewat throw,
            // supaya body balasan penerima tetap kesimpan buat debugging admin.
            validateStatus: () => true,
            maxRedirects: 0
        });

        const ok = res.status >= 200 && res.status < 300;
        const bodySnippet = typeof res.data === "string" ? res.data : JSON.stringify(res.data || "");

        if (ok) {
            await supabase
                .from("webhook_deliveries")
                .update({
                    status: "success",
                    attempt_count: attemptCount,
                    response_status: res.status,
                    response_body: bodySnippet.slice(0, MAX_RESPONSE_SNIPPET),
                    last_error: null,
                    next_retry_at: null,
                    locked_at: null,
                    lock_token: null,
                    updated_at: new Date().toISOString()
                })
                .eq("id", delivery.id);
            await bumpEndpointStats(endpoint.id, true);
            return { ok: true, status: res.status };
        }

        await supabase
            .from("webhook_deliveries")
            .update(
                schedulePatchAfterFailure(
                    attemptCount,
                    "Penerima balas HTTP " + res.status,
                    res.status,
                    bodySnippet,
                    delivery.event
                )
            )
            .eq("id", delivery.id);
        await bumpEndpointStats(endpoint.id, false);
        return { ok: false, status: res.status, body: bodySnippet.slice(0, MAX_RESPONSE_SNIPPET) };
    } catch (err) {
        await supabase
            .from("webhook_deliveries")
            .update(schedulePatchAfterFailure(attemptCount, err.message, null, null, delivery.event))
            .eq("id", delivery.id);
        await bumpEndpointStats(endpoint.id, false);
        return { ok: false, error: err.message };
    }
}

// Ambil sejumlah antrean yang siap kirim, kunci satu per satu (biar dua
// proses/poller gak ngirim baris yang sama), lalu kirim.
async function flushPendingDeliveries(limit = 20) {
    const now = new Date().toISOString();
    const lockToken = crypto.randomUUID();

    // Pulihkan baris yang nyangkut di "sending" (mis. proses mati di tengah
    // jalan) supaya gak ngambang selamanya.
    const fiveMinsAgo = new Date(Date.now() - 5 * 60000).toISOString();
    await supabase
        .from("webhook_deliveries")
        .update({ status: "pending", locked_at: null, lock_token: null, updated_at: now })
        .eq("status", "sending")
        .lt("locked_at", fiveMinsAgo);

    const { data: candidates, error } = await supabase
        .from("webhook_deliveries")
        .select("id")
        .in("status", ["pending", "failed"])
        .or("next_retry_at.is.null,next_retry_at.lte." + now)
        .order("created_at", { ascending: true })
        .limit(limit);

    if (error) {
        throwIfMissing(error);
        throw error;
    }
    if (!candidates || !candidates.length) return { sent: 0 };

    let sent = 0;
    for (const candidate of candidates) {
        const { data: claimed } = await supabase
            .from("webhook_deliveries")
            .update({ status: "sending", locked_at: new Date().toISOString(), lock_token: lockToken })
            .eq("id", candidate.id)
            .in("status", ["pending", "failed"])
            .is("locked_at", null)
            .select("*")
            .maybeSingle();

        if (!claimed) continue; // sudah diambil proses lain

        const { data: endpoint } = await supabase
            .from("webhook_endpoints")
            .select("*")
            .eq("id", claimed.endpoint_id)
            .maybeSingle();

        if (!endpoint || !endpoint.is_active) {
            await supabase
                .from("webhook_deliveries")
                .update({
                    status: "dead",
                    last_error: endpoint ? "Endpoint dinonaktifkan admin" : "Endpoint sudah dihapus",
                    locked_at: null,
                    lock_token: null,
                    next_retry_at: null,
                    updated_at: new Date().toISOString()
                })
                .eq("id", claimed.id);
            continue;
        }

        await sendDelivery(claimed, endpoint);
        sent++;
    }

    return { sent };
}

// Kirim satu payload uji ke endpoint tertentu (tombol "Tes Kirim" di
// dashboard). dedup_key sengaja NULL supaya boleh diulang berkali-kali.
async function sendTestDelivery(endpointId) {
    const { data: endpoint, error } = await supabase
        .from("webhook_endpoints")
        .select("*")
        .eq("id", endpointId)
        .maybeSingle();

    if (error) {
        throwIfMissing(error);
        throw error;
    }
    if (!endpoint) {
        const err = new Error("Endpoint tidak ditemukan");
        err.status = 404;
        throw err;
    }

    const refId = "TEST-" + Date.now();
    const { data: delivery, error: insertErr } = await supabase
        .from("webhook_deliveries")
        .insert({
            endpoint_id: endpoint.id,
            event: "nexshop.test",
            ref_id: refId,
            dedup_key: null,
            payload: {
                source: "nexshop",
                relayed_by: "nexshop",
                received_at: new Date().toISOString(),
                test: true,
                data: {
                    ref_id: refId,
                    status: "sukses",
                    message: "Ini payload uji dari NexShop Webhook Relay.",
                    sn: "TEST-SN-000000"
                }
            },
            status: "sending",
            attempt_count: 0,
            locked_at: new Date().toISOString(),
            lock_token: crypto.randomUUID()
        })
        .select("*")
        .single();

    if (insertErr) {
        throwIfMissing(insertErr);
        throw insertErr;
    }

    return sendDelivery(delivery, endpoint);
}

module.exports = {
    RELAY_NOT_SETUP_CODE,
    RELAY_NOT_SETUP_MESSAGE,
    RelayNotSetupError,
    isRelayMissing,
    throwIfMissing,
    assertSafeTargetUrl,
    generateSecret,
    signPayload,
    endpointMatchesRef,
    enqueueTokoVoucherRelay,
    flushPendingDeliveries,
    sendTestDelivery,
    MAX_ATTEMPTS
};
