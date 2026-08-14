-- =============================================================
-- NexShop Legacy Gaming News System — Database Migration
-- Jalankan di Supabase SQL Editor
-- Aman dijalankan berkali-kali (idempotent via IF NOT EXISTS)
-- =============================================================

CREATE TABLE IF NOT EXISTS gaming_news (
    id                  BIGSERIAL PRIMARY KEY,
    title               TEXT NOT NULL,
    summary             TEXT,
    source              TEXT NOT NULL,
    source_url          TEXT,
    canonical_url       TEXT,
    image_url           TEXT,
    publisher_logo_url  TEXT,
    category            TEXT DEFAULT 'Umum',
    tags                TEXT[] DEFAULT '{}',
    published_at        TIMESTAMPTZ,
    is_active           BOOLEAN DEFAULT true,
    is_hidden           BOOLEAN DEFAULT false,
    is_pinned           BOOLEAN DEFAULT false,
    is_featured         BOOLEAN DEFAULT false,
    sort_order          INTEGER DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexing untuk query performance
CREATE INDEX IF NOT EXISTS idx_gaming_news_is_pinned ON gaming_news (is_pinned) WHERE is_pinned = true;
CREATE INDEX IF NOT EXISTS idx_gaming_news_is_featured ON gaming_news (is_featured) WHERE is_featured = true;
CREATE INDEX IF NOT EXISTS idx_gaming_news_sort_order ON gaming_news (sort_order DESC);
CREATE INDEX IF NOT EXISTS idx_gaming_news_published_at ON gaming_news (published_at DESC NULLS LAST);
