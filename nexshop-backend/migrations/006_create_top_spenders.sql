-- 006_create_top_spenders.sql
-- WAJIB dijalankan di Supabase SQL Editor SEBELUM restart backend.
-- Fitur "Community Leaderboard / Hall of Fame" (GET /api/stats/leaderboard,
-- dan seluruh CRUD /api/stats/admin/leaderboard di statsController.js)
-- query ke tabel `top_spenders`, tapi tabel ini belum pernah dibuat lewat
-- migration manapun di repo.

CREATE TABLE IF NOT EXISTS top_spenders (
    id BIGSERIAL PRIMARY KEY,
    display_name TEXT NOT NULL,
    total_spending NUMERIC NOT NULL DEFAULT 0,
    avatar_url TEXT,
    badge TEXT,
    rank INTEGER NOT NULL DEFAULT 99,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_top_spenders_active_rank
    ON top_spenders (is_active, rank);
