-- =============================================================
-- NexBot RAG System — Database Migration
-- Jalankan di Supabase SQL Editor
-- =============================================================

-- Tambahkan kolom baru untuk RAG dan Website Ingestion pada knowledge_base
ALTER TABLE knowledge_base
ADD COLUMN IF NOT EXISTS source_url TEXT,
ADD COLUMN IF NOT EXISTS source_title TEXT,
ADD COLUMN IF NOT EXISTS content_hash TEXT,
ADD COLUMN IF NOT EXISTS chunk_index INTEGER DEFAULT 0;

-- Buat index untuk pencarian hash agar mempercepat deduplikasi
CREATE INDEX IF NOT EXISTS idx_knowledge_base_content_hash ON knowledge_base(content_hash);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_source_url ON knowledge_base(source_url);
