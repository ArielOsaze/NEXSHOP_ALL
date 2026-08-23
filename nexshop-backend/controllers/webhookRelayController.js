// ===========================================================
// WEBHOOK RELAY — endpoint admin
//
// Panel "Webhook Relay" di Settings dashboard ngobrol ke sini. Logika
// pengiriman + keamanan URL-nya ada di services/webhookRelayService.js;
// file ini cuma validasi input, cek izin, dan format balasan.
//
// Selama migrations/009_create_webhook_relay.sql belum dijalankan, semua
// handler di sini balas 503 + code WEBHOOK_RELAY_NOT_SETUP (bukan 500),
// persis pola yang dipakai fitur reseller.
// ===========================================================

const supabase = require("../config/db");
const relay = require("../services/webhookRelayService");

const MAX_LABEL_LENGTH = 80;
const MAX_PREFIX_LENGTH = 40;
const MAX_NOTE_LENGTH = 300;

// Semua handler dibungkus ini supaya "tabel belum ada" dan error yang
// sudah punya .status gak pernah bocor jadi 500 mentah.
function handleError(res, err, fallbackMessage) {
    if (err instanceof relay.RelayNotSetupError || relay.isRelayMissing(err)) {
        return res.status(503).json({
            message: relay.RELAY_NOT_SETUP_MESSAGE,
            code: relay.RELAY_NOT_SETUP_CODE
        });
    }
    const status = Number(err && err.status);
    if (status >= 400 && status < 600) {
        return res.status(status).json({ message: err.message });
    }
    console.log("[webhook-relay]", fallbackMessage, "-", err && err.message);
    return res.status(500).json({ message: fallbackMessage });
}

// Secret gak pernah dikirim utuh ke daftar; admin harus klik "Lihat Secret"
// (butuh Security PIN) buat lihat aslinya.
function maskSecret(secret) {
    const value = String(secret || "");
    if (value.length <= 12) return "••••••••";
    return value.slice(0, 10) + "••••••••" + value.slice(-4);
}

function shapeEndpoint(row) {
    return {
        id: row.id,
        label: row.label,
        target_url: row.target_url,
        secret_masked: maskSecret(row.secret),
        is_active: row.is_active,
        ref_prefix: row.ref_prefix,
        forward_all: row.forward_all,
        owner_user_id: row.owner_user_id,
        owner_note: row.owner_note,
        forward_original_signature: row.forward_original_signature,
        total_delivered: row.total_delivered || 0,
        total_failed: row.total_failed || 0,
        last_delivery_at: row.last_delivery_at,
        last_status: row.last_status,
        created_at: row.created_at,
        updated_at: row.updated_at
    };
}

function cleanText(value, maxLength) {
    if (value === undefined || value === null) return null;
    const trimmed = String(value).trim();
    if (!trimmed) return null;
    return trimmed.slice(0, maxLength);
}

// ===========================================================
// GET /api/webhooks/admin/info
// URL yang harus dipasang admin di dashboard TokoVoucher, plus ringkasan
// antrean. Dipanggil tiap kali tab Webhook Relay dibuka.
// ===========================================================
exports.getRelayInfo = async (req, res) => {
    const backendUrl = String(process.env.BACKEND_URL || "").replace(/\/$/, "");
    const inboundUrl = (backendUrl || "https://nexshop.cloud") + "/api/topup/tokovoucher-webhook";

    const info = {
        inbound_url: inboundUrl,
        signature_header: "X-NexShop-Signature",
        signature_format: "sha256=HMAC_SHA256(secret, timestamp + '.' + rawBody)",
        timestamp_header: "X-NexShop-Timestamp",
        max_attempts: relay.MAX_ATTEMPTS,
        setup: true,
        counts: { endpoints: 0, active: 0, pending: 0, failed: 0, dead: 0 }
    };

    try {
        const { data: endpoints, error } = await supabase
            .from("webhook_endpoints")
            .select("id, is_active");
        if (error) {
            relay.throwIfMissing(error);
            throw error;
        }
        info.counts.endpoints = (endpoints || []).length;
        info.counts.active = (endpoints || []).filter((e) => e.is_active).length;

        const { data: queue } = await supabase
            .from("webhook_deliveries")
            .select("status")
            .in("status", ["pending", "failed", "dead"])
            .limit(1000);
        for (const row of queue || []) {
            if (info.counts[row.status] !== undefined) info.counts[row.status] += 1;
        }

        res.json(info);
    } catch (err) {
        if (err instanceof relay.RelayNotSetupError || relay.isRelayMissing(err)) {
            // Info dasarnya tetap berguna (admin bisa nyalin URL inbound)
            // walau tabelnya belum dibuat, jadi jangan dibalas error total.
            return res.json({
                ...info,
                setup: false,
                setup_message: relay.RELAY_NOT_SETUP_MESSAGE,
                code: relay.RELAY_NOT_SETUP_CODE
            });
        }
        handleError(res, err, "Gagal mengambil info Webhook Relay");
    }
};

// ===========================================================
// GET /api/webhooks/admin/endpoints
// ===========================================================
exports.listEndpoints = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("webhook_endpoints")
            .select("*")
            .order("created_at", { ascending: false });
        if (error) {
            relay.throwIfMissing(error);
            throw error;
        }
        res.json({ endpoints: (data || []).map(shapeEndpoint) });
    } catch (err) {
        handleError(res, err, "Gagal mengambil daftar endpoint");
    }
};

// ===========================================================
// POST /api/webhooks/admin/endpoints
// ===========================================================
exports.createEndpoint = async (req, res) => {
    try {
        const label = cleanText(req.body.label, MAX_LABEL_LENGTH);
        if (!label) return res.status(400).json({ message: "Nama toko/label wajib diisi" });

        const forwardAll = req.body.forward_all === true || req.body.forward_all === "true";
        const refPrefix = cleanText(req.body.ref_prefix, MAX_PREFIX_LENGTH);
        if (!forwardAll && !refPrefix) {
            return res.status(400).json({
                message: "Isi Prefix Ref ID, atau centang 'Terima semua callback'. Tanpa salah satunya, endpoint ini gak akan pernah kebagian callback."
            });
        }

        // Validasi + proteksi SSRF dijalankan sebelum apa pun disimpan.
        const targetUrl = await relay.assertSafeTargetUrl(req.body.target_url);

        const ownerRaw = req.body.owner_user_id;
        const ownerUserId =
            ownerRaw === undefined || ownerRaw === null || ownerRaw === "" ? null : Number(ownerRaw);
        if (ownerUserId !== null && !Number.isInteger(ownerUserId)) {
            return res.status(400).json({ message: "Owner User ID harus berupa angka" });
        }

        const payload = {
            label,
            target_url: targetUrl,
            secret: relay.generateSecret(),
            is_active: req.body.is_active === false ? false : true,
            ref_prefix: refPrefix,
            forward_all: forwardAll,
            owner_user_id: ownerUserId,
            owner_note: cleanText(req.body.owner_note, MAX_NOTE_LENGTH),
            forward_original_signature: req.body.forward_original_signature === true
        };

        const { data, error } = await supabase
            .from("webhook_endpoints")
            .insert(payload)
            .select("*")
            .single();

        if (error) {
            relay.throwIfMissing(error);
            if (String(error.code) === "23505") {
                return res.status(409).json({ message: "URL webhook itu sudah terdaftar." });
            }
            throw error;
        }

        // Secret ditampilkan UTUH sekali ini saja, pas dibuat -- setelah ini
        // admin harus lewat "Lihat Secret" (pakai Security PIN).
        res.status(201).json({
            message: "Endpoint webhook berhasil dibuat",
            endpoint: shapeEndpoint(data),
            secret: data.secret
        });
    } catch (err) {
        handleError(res, err, "Gagal membuat endpoint webhook");
    }
};

// ===========================================================
// PUT /api/webhooks/admin/endpoints/:id
// ===========================================================
exports.updateEndpoint = async (req, res) => {
    try {
        const { data: existing, error: findErr } = await supabase
            .from("webhook_endpoints")
            .select("*")
            .eq("id", req.params.id)
            .maybeSingle();
        if (findErr) {
            relay.throwIfMissing(findErr);
            throw findErr;
        }
        if (!existing) return res.status(404).json({ message: "Endpoint tidak ditemukan" });

        const updates = { updated_at: new Date().toISOString() };

        if (req.body.label !== undefined) {
            const label = cleanText(req.body.label, MAX_LABEL_LENGTH);
            if (!label) return res.status(400).json({ message: "Nama toko/label wajib diisi" });
            updates.label = label;
        }
        if (req.body.target_url !== undefined) {
            updates.target_url = await relay.assertSafeTargetUrl(req.body.target_url);
        }
        if (req.body.is_active !== undefined) {
            updates.is_active = req.body.is_active === true || req.body.is_active === "true";
        }
        if (req.body.forward_original_signature !== undefined) {
            updates.forward_original_signature = req.body.forward_original_signature === true;
        }
        if (req.body.owner_note !== undefined) {
            updates.owner_note = cleanText(req.body.owner_note, MAX_NOTE_LENGTH);
        }
        if (req.body.owner_user_id !== undefined) {
            const ownerRaw = req.body.owner_user_id;
            const ownerUserId = ownerRaw === null || ownerRaw === "" ? null : Number(ownerRaw);
            if (ownerUserId !== null && !Number.isInteger(ownerUserId)) {
                return res.status(400).json({ message: "Owner User ID harus berupa angka" });
            }
            updates.owner_user_id = ownerUserId;
        }

        // ref_prefix & forward_all saling terkait: dicek bareng pakai nilai
        // akhir (gabungan yang lama + yang baru), bukan sendiri-sendiri.
        const nextForwardAll =
            req.body.forward_all !== undefined
                ? req.body.forward_all === true || req.body.forward_all === "true"
                : existing.forward_all;
        const nextPrefix =
            req.body.ref_prefix !== undefined
                ? cleanText(req.body.ref_prefix, MAX_PREFIX_LENGTH)
                : existing.ref_prefix;
        if (!nextForwardAll && !nextPrefix) {
            return res.status(400).json({
                message: "Isi Prefix Ref ID, atau centang 'Terima semua callback'."
            });
        }
        if (req.body.forward_all !== undefined) updates.forward_all = nextForwardAll;
        if (req.body.ref_prefix !== undefined) updates.ref_prefix = nextPrefix;

        const { data, error } = await supabase
            .from("webhook_endpoints")
            .update(updates)
            .eq("id", req.params.id)
            .select("*")
            .single();

        if (error) {
            relay.throwIfMissing(error);
            if (String(error.code) === "23505") {
                return res.status(409).json({ message: "URL webhook itu sudah dipakai endpoint lain." });
            }
            throw error;
        }

        res.json({ message: "Endpoint diperbarui", endpoint: shapeEndpoint(data) });
    } catch (err) {
        handleError(res, err, "Gagal memperbarui endpoint webhook");
    }
};

// ===========================================================
// DELETE /api/webhooks/admin/endpoints/:id
// Riwayat pengirimannya ikut kehapus (ON DELETE CASCADE di migration).
// ===========================================================
exports.deleteEndpoint = async (req, res) => {
    try {
        const { error } = await supabase.from("webhook_endpoints").delete().eq("id", req.params.id);
        if (error) {
            relay.throwIfMissing(error);
            throw error;
        }
        res.json({ message: "Endpoint dihapus" });
    } catch (err) {
        handleError(res, err, "Gagal menghapus endpoint webhook");
    }
};

// ===========================================================
// POST /api/webhooks/admin/endpoints/:id/secret   (butuh Security PIN)
// ===========================================================
exports.revealSecret = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("webhook_endpoints")
            .select("id, secret")
            .eq("id", req.params.id)
            .maybeSingle();
        if (error) {
            relay.throwIfMissing(error);
            throw error;
        }
        if (!data) return res.status(404).json({ message: "Endpoint tidak ditemukan" });
        res.json({ secret: data.secret });
    } catch (err) {
        handleError(res, err, "Gagal mengambil secret endpoint");
    }
};

// ===========================================================
// POST /api/webhooks/admin/endpoints/:id/rotate-secret   (butuh Security PIN)
// ===========================================================
exports.rotateSecret = async (req, res) => {
    try {
        const secret = relay.generateSecret();
        const { data, error } = await supabase
            .from("webhook_endpoints")
            .update({ secret, updated_at: new Date().toISOString() })
            .eq("id", req.params.id)
            .select("id")
            .maybeSingle();
        if (error) {
            relay.throwIfMissing(error);
            throw error;
        }
        if (!data) return res.status(404).json({ message: "Endpoint tidak ditemukan" });
        res.json({
            message: "Secret diganti. Kasih tahu pemilik toko supaya mereka update verifikasinya.",
            secret
        });
    } catch (err) {
        handleError(res, err, "Gagal mengganti secret endpoint");
    }
};

// ===========================================================
// POST /api/webhooks/admin/endpoints/:id/test
// ===========================================================
exports.testEndpoint = async (req, res) => {
    try {
        const result = await relay.sendTestDelivery(req.params.id);
        if (result.ok) {
            return res.json({ message: "Payload uji terkirim (HTTP " + result.status + ")", result });
        }
        res.status(200).json({
            message: result.status
                ? "Penerima balas HTTP " + result.status + " (bukan 2xx)"
                : "Gagal kirim: " + (result.error || "tidak diketahui"),
            result,
            failed: true
        });
    } catch (err) {
        handleError(res, err, "Gagal mengirim payload uji");
    }
};

// ===========================================================
// GET /api/webhooks/admin/deliveries?endpoint_id=&status=&limit=
// ===========================================================
exports.listDeliveries = async (req, res) => {
    try {
        const limitRaw = Number(req.query.limit);
        const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 50;

        let query = supabase
            .from("webhook_deliveries")
            .select("id, endpoint_id, event, ref_id, status, attempt_count, response_status, response_body, last_error, next_retry_at, created_at, updated_at")
            .order("created_at", { ascending: false })
            .limit(limit);

        if (req.query.endpoint_id) query = query.eq("endpoint_id", req.query.endpoint_id);
        if (req.query.status) query = query.eq("status", String(req.query.status));

        const { data, error } = await query;
        if (error) {
            relay.throwIfMissing(error);
            throw error;
        }
        res.json({ deliveries: data || [] });
    } catch (err) {
        handleError(res, err, "Gagal mengambil riwayat pengiriman");
    }
};

// ===========================================================
// POST /api/webhooks/admin/deliveries/:id/retry
// Antre ulang pengiriman yang gagal/mati, lalu langsung coba kirim.
// ===========================================================
exports.retryDelivery = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("webhook_deliveries")
            .update({
                status: "pending",
                attempt_count: 0,
                next_retry_at: null,
                locked_at: null,
                lock_token: null,
                last_error: null,
                updated_at: new Date().toISOString()
            })
            .eq("id", req.params.id)
            .select("id")
            .maybeSingle();

        if (error) {
            relay.throwIfMissing(error);
            throw error;
        }
        if (!data) return res.status(404).json({ message: "Riwayat pengiriman tidak ditemukan" });

        const result = await relay.flushPendingDeliveries(5);
        res.json({ message: "Pengiriman diantre ulang", sent: result.sent });
    } catch (err) {
        handleError(res, err, "Gagal mengantre ulang pengiriman");
    }
};
