-- =============================================================
-- NexShop News Editorial System — Database Migration
-- Jalankan di Supabase SQL Editor
-- Aman dijalankan berkali-kali (idempotent via IF NOT EXISTS)
-- Tidak menghapus tabel gaming_news atau data apapun yang ada
-- =============================================================

-- ---------------------------------------------------------------
-- 1. Tabel utama artikel editorial NexShop
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS news_articles (
    id          BIGSERIAL PRIMARY KEY,
    slug        TEXT        NOT NULL UNIQUE,
    title       TEXT        NOT NULL,
    excerpt     TEXT,
    content     TEXT,
    category    TEXT        NOT NULL DEFAULT 'Gaming',
    tags        TEXT[]      NOT NULL DEFAULT '{}',
    author      TEXT        NOT NULL DEFAULT 'NexShop Editorial',
    status      TEXT        NOT NULL DEFAULT 'draft'
                    CONSTRAINT news_articles_status_check
                    CHECK (status IN ('draft', 'published', 'scheduled')),
    published_at    TIMESTAMPTZ,
    scheduled_at    TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    image_url        TEXT,
    image_alt        TEXT,
    image_credit     TEXT,
    image_source_url TEXT,
    seo_title        TEXT,
    seo_description  TEXT,
    keywords         TEXT[] NOT NULL DEFAULT '{}',
    view_count       BIGINT  NOT NULL DEFAULT 0,
    is_featured      BOOLEAN NOT NULL DEFAULT false,
    is_pinned        BOOLEAN NOT NULL DEFAULT false
);

-- ---------------------------------------------------------------
-- 2. Constraint slug format (idempotent)
-- ---------------------------------------------------------------
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'news_articles_slug_format'
          AND conrelid = 'news_articles'::regclass
    ) THEN
        ALTER TABLE news_articles
        ADD CONSTRAINT news_articles_slug_format
        CHECK (slug ~ '^[a-z0-9][a-z0-9\-]*[a-z0-9]$');
    END IF;
END $$;

-- ---------------------------------------------------------------
-- 3. Index
-- ---------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_news_articles_slug
    ON news_articles (slug);

CREATE INDEX IF NOT EXISTS idx_news_articles_status
    ON news_articles (status);

CREATE INDEX IF NOT EXISTS idx_news_articles_category
    ON news_articles (category);

CREATE INDEX IF NOT EXISTS idx_news_articles_published_at
    ON news_articles (published_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_news_articles_scheduled_at
    ON news_articles (scheduled_at)
    WHERE status = 'scheduled';

CREATE INDEX IF NOT EXISTS idx_news_articles_is_featured
    ON news_articles (is_featured)
    WHERE is_featured = true;

CREATE INDEX IF NOT EXISTS idx_news_articles_is_pinned
    ON news_articles (is_pinned)
    WHERE is_pinned = true;

CREATE INDEX IF NOT EXISTS idx_news_articles_view_count
    ON news_articles (view_count DESC);

CREATE INDEX IF NOT EXISTS idx_news_articles_public
    ON news_articles (status, published_at DESC NULLS LAST)
    WHERE status = 'published';

-- ---------------------------------------------------------------
-- 4. Tabel sumber referensi riset per artikel
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS news_sources (
    id                  BIGSERIAL PRIMARY KEY,
    article_id          BIGINT      NOT NULL
                            REFERENCES news_articles(id) ON DELETE CASCADE,
    source_name         TEXT        NOT NULL,
    source_url          TEXT        NOT NULL,
    source_title        TEXT,
    source_published_at TIMESTAMPTZ,
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_news_sources_article_id
    ON news_sources (article_id);

-- ---------------------------------------------------------------
-- 5. Verifikasi
-- ---------------------------------------------------------------
DO $$ BEGIN
    RAISE NOTICE 'NexShop News migration selesai.';
    RAISE NOTICE 'Tabel news_articles: %', (SELECT COUNT(*) FROM news_articles);
    RAISE NOTICE 'Tabel news_sources : %', (SELECT COUNT(*) FROM news_sources);
END $$;
