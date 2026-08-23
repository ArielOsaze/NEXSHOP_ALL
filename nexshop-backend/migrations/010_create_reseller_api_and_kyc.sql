-- Migration 010: Reseller API Keys, IP Whitelist, dan KYC KTP
--
-- CATATAN: file migration di repo ini TIDAK dijalankan otomatis (lihat AGENTS.md).
-- Terapkan file ini di Supabase SQL Editor sebelum fitur API Key & KYC dipakai.
-- Kode backend dibuat graceful: selama tabel/kolom baru belum ada, endpoint
-- akan memberikan pesan yang ramah tanpa error 500 mentah.

-- ===========================================================
-- 1. Tambah kolom Foto KTP dan NIK pada pengajuan reseller
-- ===========================================================
ALTER TABLE reseller_applications ADD COLUMN IF NOT EXISTS ktp_url TEXT;
ALTER TABLE reseller_applications ADD COLUMN IF NOT EXISTS nik VARCHAR(20);

-- ===========================================================
-- 2. Tabel Kredensial API & Keamanan Mitra Reseller
-- ===========================================================
CREATE TABLE IF NOT EXISTS reseller_api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    api_key TEXT UNIQUE NOT NULL,
    secret_key TEXT NOT NULL,
    ip_whitelist TEXT,              -- format: comma-separated IP (misal: 103.123.45.67, 192.168.1.1)
    webhook_url TEXT,               -- URL endpoint callback milik reseller
    webhook_secret TEXT,            -- Secret key untuk tanda tangan webhook reseller
    is_active BOOLEAN NOT NULL DEFAULT true,
    total_requests BIGINT NOT NULL DEFAULT 0,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT reseller_api_keys_user_unique UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_reseller_api_keys_user ON reseller_api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_reseller_api_keys_key ON reseller_api_keys(api_key);
