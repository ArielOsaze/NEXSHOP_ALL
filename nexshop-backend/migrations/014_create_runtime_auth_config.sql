-- Konfigurasi autentikasi yang dapat diubah dari Admin Dashboard.
-- Nilai di tabel ini mengalahkan .env, sedangkan .env tetap menjadi fallback
-- saat sebuah nilai belum pernah disimpan dari dashboard.
--
-- Jangan membuat policy SELECT untuk anon/authenticated: tabel ini juga
-- memuat secret OAuth dan Turnstile. Backend mengaksesnya memakai service key.
CREATE TABLE IF NOT EXISTS runtime_config (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO runtime_config (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE runtime_config ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE runtime_config IS
    'Override runtime yang hanya boleh diakses backend, misalnya Turnstile dan Google OAuth.';
