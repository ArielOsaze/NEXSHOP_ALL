-- Migration 007: Extend topup_products for Full TokoVoucher Catalog Sync

-- Add source tracking metadata columns to topup_products
ALTER TABLE topup_products ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'tokovoucher';
ALTER TABLE topup_products ADD COLUMN IF NOT EXISTS source_product_id TEXT;
ALTER TABLE topup_products ADD COLUMN IF NOT EXISTS source_category_id TEXT;
ALTER TABLE topup_products ADD COLUMN IF NOT EXISTS source_category_name TEXT;
ALTER TABLE topup_products ADD COLUMN IF NOT EXISTS source_operator_id TEXT;
ALTER TABLE topup_products ADD COLUMN IF NOT EXISTS source_operator_name TEXT;
ALTER TABLE topup_products ADD COLUMN IF NOT EXISTS source_jenis_id TEXT;
ALTER TABLE topup_products ADD COLUMN IF NOT EXISTS source_jenis_name TEXT;
ALTER TABLE topup_products ADD COLUMN IF NOT EXISTS source_status TEXT DEFAULT 'active';
ALTER TABLE topup_products ADD COLUMN IF NOT EXISTS source_last_seen_at TIMESTAMPTZ;
ALTER TABLE topup_products ADD COLUMN IF NOT EXISTS source_last_synced_at TIMESTAMPTZ;
ALTER TABLE topup_products ADD COLUMN IF NOT EXISTS source_raw_hash TEXT;
ALTER TABLE topup_products ADD COLUMN IF NOT EXISTS source_missing_count INTEGER DEFAULT 0;

-- Add admin override flags (so automatic sync doesn't overwrite manual changes)
ALTER TABLE topup_products ADD COLUMN IF NOT EXISTS auto_managed BOOLEAN DEFAULT true;
ALTER TABLE topup_products ADD COLUMN IF NOT EXISTS manual_category_override BOOLEAN DEFAULT false;
ALTER TABLE topup_products ADD COLUMN IF NOT EXISTS manual_name_override BOOLEAN DEFAULT false;
ALTER TABLE topup_products ADD COLUMN IF NOT EXISTS manual_image_override BOOLEAN DEFAULT false;

-- Create unique index on kode_produk for deduplication during bulk upsert
-- Note: Ensure no duplicates exist manually before applying this if necessary.
CREATE UNIQUE INDEX IF NOT EXISTS idx_topup_products_kode_produk ON topup_products(kode_produk);

-- Create table for tracking catalog sync history/logs
CREATE TABLE IF NOT EXISTS catalog_sync_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    status TEXT NOT NULL CHECK (status IN ('running', 'success', 'error')),
    error_message TEXT,
    products_found INTEGER DEFAULT 0,
    products_added INTEGER DEFAULT 0,
    products_updated INTEGER DEFAULT 0,
    products_missing INTEGER DEFAULT 0,
    products_skipped_foreign INTEGER DEFAULT 0,
    trigger_type TEXT DEFAULT 'manual' CHECK (trigger_type IN ('manual', 'auto'))
);

-- Create table for category mapping (TokoVoucher Category -> NexShop Category)
CREATE TABLE IF NOT EXISTS topup_category_map (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tokovoucher_category_name TEXT UNIQUE NOT NULL,
    nexshop_category_name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RPC to increment missing count
CREATE OR REPLACE FUNCTION increment_missing_count(product_codes text[])
RETURNS void AS $$
BEGIN
    UPDATE topup_products
    SET source_missing_count = source_missing_count + 1
    WHERE kode_produk = ANY(product_codes);
END;
$$ LANGUAGE plpgsql;
