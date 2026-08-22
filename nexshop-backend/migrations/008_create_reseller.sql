-- Migration 008: Program Reseller (pendaftaran + harga bertingkat)
--
-- CATATAN: file migration di repo ini TIDAK dijalankan otomatis (lihat
-- AGENTS.md). Jalankan isi file ini manual di Supabase SQL Editor sebelum
-- fitur reseller dipakai. Sebelum dijalankan, endpoint reseller akan balas
-- pesan "belum di-setup" yang ramah, bukan error 500 mentah.

-- ===========================================================
-- 1. Status reseller nempel di user
--
-- SENGAJA TIDAK memakai kolom `role`. Kolom itu dipakai buat gerbang akses
-- dashboard (admin/staff, lihat middleware/adminSession.js) -- kalau
-- "reseller" ikut ditaruh di sana, tiap penambahan role baru berisiko
-- kesenggol logika izin admin. Status reseller berdiri sendiri di kolom
-- terpisah supaya dua konsep itu gak saling ganggu.
-- ===========================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS reseller_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE users ADD COLUMN IF NOT EXISTS reseller_tier TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reseller_since TIMESTAMPTZ;

-- none = user biasa, pending = lagi diajukan, approved = reseller aktif,
-- rejected = ditolak, suspended = dibekukan admin
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_reseller_status_check;
ALTER TABLE users ADD CONSTRAINT users_reseller_status_check
    CHECK (reseller_status IN ('none', 'pending', 'approved', 'rejected', 'suspended'));

-- ===========================================================
-- 2. Tingkatan reseller + persen diskonnya
-- ===========================================================
CREATE TABLE IF NOT EXISTS reseller_tiers (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
    description TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT reseller_tiers_percent_check CHECK (discount_percent >= 0 AND discount_percent <= 30)
);

INSERT INTO reseller_tiers (code, name, discount_percent, description, sort_order) VALUES
    ('silver',   'Silver',   2.0, 'Tingkat awal untuk reseller baru.',                 1),
    ('gold',     'Gold',     3.5, 'Untuk reseller dengan transaksi rutin.',            2),
    ('platinum', 'Platinum', 5.0, 'Untuk reseller volume besar / mitra jangka panjang.', 3)
ON CONFLICT (code) DO NOTHING;

-- ===========================================================
-- 3. Pengajuan jadi reseller
-- ===========================================================
CREATE TABLE IF NOT EXISTS reseller_applications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    fullname TEXT NOT NULL,
    whatsapp TEXT NOT NULL,
    store_name TEXT,
    channel TEXT,
    monthly_estimate TEXT,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    tier_code TEXT REFERENCES reseller_tiers(code) ON DELETE SET NULL,
    admin_note TEXT,
    reviewed_by TEXT,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT reseller_applications_status_check CHECK (status IN ('pending', 'approved', 'rejected'))
);

CREATE INDEX IF NOT EXISTS idx_reseller_app_status ON reseller_applications(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reseller_app_user ON reseller_applications(user_id, created_at DESC);

-- Satu user cuma boleh punya SATU pengajuan yang masih pending. Dipaksa di
-- level database, bukan cuma dicek di controller, supaya dua request yang
-- datang barengan gak bisa nyelip bikin pengajuan dobel.
CREATE UNIQUE INDEX IF NOT EXISTS idx_reseller_app_one_pending
    ON reseller_applications(user_id) WHERE status = 'pending';
