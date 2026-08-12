-- Migration: Add Fonnte Config & Notification Events

-- 1. Tambah fonnte_token ke api_keys (secret key)
ALTER TABLE api_keys
ADD COLUMN IF NOT EXISTS fonnte_token VARCHAR(255);

-- 2. Tambah setting notifikasi user ke store_settings
ALTER TABLE store_settings
ADD COLUMN IF NOT EXISTS fonnte_user_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS wa_template_pending TEXT DEFAULT 'Halo {name}, pesanan kamu #{order_id} berhasil dibuat!\n\nSilakan lakukan pembayaran sebesar {total} sebelum waktu habis.\n\nTerima kasih, NexShop.',
ADD COLUMN IF NOT EXISTS wa_template_success TEXT DEFAULT 'Halo {name}, pembayaran untuk pesanan #{order_id} sebesar {total} telah kami terima.\n\nPesanan sedang diproses, terima kasih sudah berbelanja di NexShop!',
ADD COLUMN IF NOT EXISTS wa_template_otp TEXT DEFAULT 'Halo!\n\nKode OTP NexShop kamu adalah: *{otp}*\n\nKode ini berlaku selama 10 menit. Jangan berikan kode ini kepada siapapun.',
ADD COLUMN IF NOT EXISTS wa_notify_pending_enabled BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS wa_notify_success_enabled BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS wa_notify_otp_enabled BOOLEAN DEFAULT true;

-- 3. Tabel Idempotency untuk menghindari duplicate notification success dari webhook
CREATE TABLE IF NOT EXISTS notification_events (
    id SERIAL PRIMARY KEY,
    order_id VARCHAR(50) NOT NULL,
    notification_type VARCHAR(20) NOT NULL,
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (order_id, notification_type)
);

-- 4. Unique Constraint untuk Nomor WhatsApp
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'users_phone_key' 
        AND conrelid = 'users'::regclass
    ) THEN
        ALTER TABLE users ADD CONSTRAINT users_phone_key UNIQUE (phone);
    END IF;
END $$;

-- 5. Tabel Rating Pengalaman Belanja per Order
CREATE TABLE IF NOT EXISTS order_ratings (
    id SERIAL PRIMARY KEY,
    order_id VARCHAR(50) NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
    user_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
    score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
    comment TEXT NULL CHECK (
        comment IS NULL OR char_length(comment) <= 500
    ),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_ratings_created_at
    ON order_ratings(created_at);

CREATE INDEX IF NOT EXISTS idx_order_ratings_score
    ON order_ratings(score);

-- 6. Bugfix: Safe Notification Events & Idempotency
ALTER TABLE notification_events
ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_error TEXT NULL,
ADD COLUMN IF NOT EXISTS locked_at TIMESTAMP WITH TIME ZONE NULL,
ADD COLUMN IF NOT EXISTS lock_token VARCHAR(64) NULL,
ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMP WITH TIME ZONE NULL;

ALTER TABLE notification_events
ALTER COLUMN sent_at DROP DEFAULT;

UPDATE notification_events
SET
  status = 'unknown',
  last_error = 'Legacy event: status pengiriman tidak dapat diverifikasi',
  next_retry_at = NULL
WHERE status = 'pending'
  AND attempt_count = 0;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'notification_events_status_check' 
        AND conrelid = 'notification_events'::regclass
    ) THEN
        ALTER TABLE notification_events
        ADD CONSTRAINT notification_events_status_check CHECK (
            status IN ('pending', 'sending', 'sent', 'failed', 'unknown')
        );
    END IF;
END $$;

-- 7. Bugfix: Topup Atomic Locks
ALTER TABLE topup_orders
ADD COLUMN IF NOT EXISTS locked_at TIMESTAMP WITH TIME ZONE NULL,
ADD COLUMN IF NOT EXISTS lock_token VARCHAR(64) NULL,
ADD COLUMN IF NOT EXISTS next_status_check_at TIMESTAMP WITH TIME ZONE NULL;
