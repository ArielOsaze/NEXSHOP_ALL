-- Migration: Add Fonnte Config & Notification Events

-- 1. Tambah fonnte_token ke api_keys (secret key)
ALTER TABLE api_keys
ADD COLUMN fonnte_token VARCHAR(255);

-- 2. Tambah setting notifikasi user ke store_settings
ALTER TABLE store_settings
ADD COLUMN fonnte_user_enabled BOOLEAN DEFAULT false,
ADD COLUMN wa_template_pending TEXT DEFAULT 'Halo {name}, pesanan kamu #{order_id} berhasil dibuat!\n\nSilakan lakukan pembayaran sebesar {total} sebelum waktu habis.\n\nTerima kasih, NexShop.',
ADD COLUMN wa_template_success TEXT DEFAULT 'Halo {name}, pembayaran untuk pesanan #{order_id} sebesar {total} telah kami terima.\n\nPesanan sedang diproses, terima kasih sudah berbelanja di NexShop!',
ADD COLUMN wa_template_otp TEXT DEFAULT 'Halo!\n\nKode OTP NexShop kamu adalah: *{otp}*\n\nKode ini berlaku selama 10 menit. Jangan berikan kode ini kepada siapapun.',
ADD COLUMN wa_notify_pending_enabled BOOLEAN DEFAULT true,
ADD COLUMN wa_notify_success_enabled BOOLEAN DEFAULT true,
ADD COLUMN wa_notify_otp_enabled BOOLEAN DEFAULT true;

-- 3. Tabel Idempotency untuk menghindari duplicate notification success dari webhook
CREATE TABLE IF NOT EXISTS notification_events (
    id SERIAL PRIMARY KEY,
    order_id VARCHAR(50) NOT NULL,
    notification_type VARCHAR(20) NOT NULL,
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (order_id, notification_type)
);

-- 4. Unique Constraint untuk Nomor WhatsApp
ALTER TABLE users ADD CONSTRAINT users_phone_key UNIQUE (phone);
