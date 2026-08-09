-- migrations-28-recipient-phone.sql
-- Nomor HP pembeli dibutuhkan iPaymu Direct Payment (QRIS/VA). Sebelumnya
-- checkout gak pernah minta nomor HP, jadi backend selalu ngirim nomor
-- default "08123456789" yang SAMA buat semua transaksi ke iPaymu -- ini
-- yang diduga bikin iPaymu nolak dengan "Suspicious buyer" (406), karena
-- pola nomor identik berulang dari banyak transaksi/pembeli berbeda
-- kelihatan seperti bot/fraud oleh sistem deteksi mereka.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS recipient_phone text;
ALTER TABLE topup_orders ADD COLUMN IF NOT EXISTS recipient_phone text;
