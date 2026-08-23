-- Migration 009: Webhook Relay NexShop (fan-out callback TokoVoucher)
--
-- CATATAN: file migration di repo ini TIDAK dijalankan otomatis (lihat
-- AGENTS.md). Jalankan isi file ini manual di Supabase SQL Editor sebelum
-- fitur Webhook Relay dipakai. Sebelum dijalankan, endpoint /api/webhooks/*
-- balas 503 dengan code "WEBHOOK_RELAY_NOT_SETUP" dan panel di dashboard
-- nampilin catatan setup -- BUKAN error 500 mentah.
--
-- ===========================================================
-- KENAPA ADA FITUR INI
--
-- TokoVoucher cuma ngasih SATU slot URL callback per akun member. Slot itu
-- kepake buat NexShop (/api/topup/tokovoucher-webhook). Akibatnya toko lain
-- / reseller yang transaksinya nebeng akun TokoVoucher NexShop gak punya
-- jalan buat nerima notifikasi status transaksinya sendiri.
--
-- Solusinya: NexShop jadi RELAY. Callback asli tetap masuk sekali ke
-- NexShop, diproses seperti biasa buat order NexShop sendiri, lalu
-- di-FORWARD ke daftar URL milik toko/reseller lain yang terdaftar di sini.
-- ===========================================================

-- ===========================================================
-- 1. Daftar tujuan relay (URL webhook milik toko/reseller lain)
-- ===========================================================
CREATE TABLE IF NOT EXISTS webhook_endpoints (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Nama toko/pemilik, cuma buat dibaca admin di dashboard
    label TEXT NOT NULL,
    target_url TEXT NOT NULL,

    -- Secret buat tanda tangan HMAC-SHA256 di header X-NexShop-Signature.
    -- Dibuat otomatis oleh server saat endpoint dibikin; penerima pakai ini
    -- buat mastiin payload beneran dari NexShop.
    secret TEXT NOT NULL,

    is_active BOOLEAN NOT NULL DEFAULT true,

    -- ROUTING: siapa yang berhak nerima callback mana.
    --   ref_prefix  : forward cuma kalau ref_id transaksi diawali prefix ini
    --                 (mis. toko A pakai ref "TKA-xxxx" -> prefix "TKA-").
    --   forward_all : abaikan prefix, terima SEMUA callback (dipakai buat
    --                 mirror/monitoring, hati-hati kebocoran data).
    ref_prefix TEXT,
    forward_all BOOLEAN NOT NULL DEFAULT false,

    -- Opsional: tautkan ke user NexShop (mis. akun reseller) supaya admin
    -- tahu endpoint ini punya siapa.
    owner_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
    owner_note TEXT,

    -- Ikutkan header signature ASLI dari TokoVoucher apa adanya. Cuma masuk
    -- akal kalau penerima juga tahu member_code+secret TokoVoucher yang sama.
    -- Default mati demi keamanan.
    forward_original_signature BOOLEAN NOT NULL DEFAULT false,

    -- Statistik ringan biar admin bisa lihat sehat/enggak tanpa buka log
    total_delivered INTEGER NOT NULL DEFAULT 0,
    total_failed INTEGER NOT NULL DEFAULT 0,
    last_delivery_at TIMESTAMPTZ,
    last_status TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT webhook_endpoints_url_scheme_check
        CHECK (target_url ~* '^https?://'),
    -- Endpoint yang gak forward_all WAJIB punya prefix, kalau enggak dia
    -- gak akan pernah kebagian apa-apa (diam-diam mati) -- lebih baik
    -- ditolak database daripada bikin admin bingung nunggu callback.
    CONSTRAINT webhook_endpoints_routing_check
        CHECK (forward_all = true OR (ref_prefix IS NOT NULL AND length(btrim(ref_prefix)) > 0))
);

CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_active
    ON webhook_endpoints(is_active, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_owner
    ON webhook_endpoints(owner_user_id);

-- Satu URL cuma boleh terdaftar sekali, biar penerima gak kena payload dobel.
CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_endpoints_url_unique
    ON webhook_endpoints(lower(target_url));

-- ===========================================================
-- 2. Antrean + riwayat pengiriman
--
-- Pengiriman TIDAK dilakukan di dalam request webhook TokoVoucher (biar
-- TokoVoucher tetap dapat 200 cepat dan gak retry-retry). Baris di sini
-- diantre dulu, dikirim di belakang layar, dan di-retry sama
-- jobs/webhookRelayPoller.js kalau gagal.
-- ===========================================================
CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    endpoint_id UUID NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,

    event TEXT NOT NULL DEFAULT 'tokovoucher.transaction',
    ref_id TEXT,
    payload JSONB NOT NULL,

    -- Kunci anti-duplikat, diisi server: "<ref_id>:<status transaksi>".
    -- Sengaja IKUT status, bukan ref_id doang -- satu transaksi wajar kirim
    -- callback lebih dari sekali kalau statusnya berubah (pending -> sukses),
    -- dan perubahan itu justru yang mau diteruskan. Yang diblokir cuma
    -- callback yang PERSIS sama (retry-nya TokoVoucher sendiri).
    dedup_key TEXT,

    -- pending  = nunggu dikirim
    -- sending  = lagi dikirim (dikunci lock_token biar gak dobel)
    -- success  = penerima balas 2xx
    -- failed   = gagal tapi masih ada jatah retry
    -- dead     = jatah retry habis, nyerah
    status TEXT NOT NULL DEFAULT 'pending',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    next_retry_at TIMESTAMPTZ,

    response_status INTEGER,
    response_body TEXT,
    last_error TEXT,

    locked_at TIMESTAMPTZ,
    lock_token TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT webhook_deliveries_status_check
        CHECK (status IN ('pending', 'sending', 'success', 'failed', 'dead'))
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_endpoint
    ON webhook_deliveries(endpoint_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_retry
    ON webhook_deliveries(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_ref
    ON webhook_deliveries(ref_id);

-- Callback yang isinya PERSIS sama cuma diantre sekali per endpoint.
-- TokoVoucher nembak ulang callback yang sama kalau balasan kita telat;
-- tanpa kunci ini, toko penerima kebanjiran payload duplikat.
--
-- Index-nya SENGAJA tidak parsial (tanpa WHERE). Antrean diisi lewat
-- ON CONFLICT (endpoint_id, dedup_key), dan Postgres cuma mau memakai
-- index parsial kalau klausa ON CONFLICT-nya ikut menyebut predikat yang
-- sama -- sesuatu yang tidak bisa dikirim lewat PostgREST. Index penuh
-- tetap aman: Postgres menghitung NULL sebagai nilai yang selalu berbeda,
-- jadi baris uji coba (dedup_key NULL) tetap boleh berkali-kali, persis
-- yang dibutuhkan tombol "Tes Kirim" di dashboard.
CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_deliveries_dedup
    ON webhook_deliveries(endpoint_id, dedup_key);
