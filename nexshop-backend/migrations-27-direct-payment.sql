-- migrations-27-direct-payment.sql

-- Tambah kolom untuk orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ipaymu_trx_id text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_no text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS qr_content text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_expired timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_flow text DEFAULT 'redirect';

-- Tambah kolom untuk topup_orders
ALTER TABLE topup_orders ADD COLUMN IF NOT EXISTS ipaymu_trx_id text;
ALTER TABLE topup_orders ADD COLUMN IF NOT EXISTS payment_no text;
ALTER TABLE topup_orders ADD COLUMN IF NOT EXISTS qr_content text;
ALTER TABLE topup_orders ADD COLUMN IF NOT EXISTS payment_expired timestamptz;
ALTER TABLE topup_orders ADD COLUMN IF NOT EXISTS payment_flow text DEFAULT 'redirect';
