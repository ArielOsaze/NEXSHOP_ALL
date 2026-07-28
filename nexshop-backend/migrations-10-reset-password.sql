-- =====================================================================
-- NexShop — migration: fitur "Lupa Password". Nambah kolom buat nyimpen
-- token reset password (BEDA sama otp_code yang buat verifikasi email pas
-- register -- ini sengaja token acak panjang, bukan 6 digit, karena reset
-- password itu lebih sensitif jadi HARUS gak bisa ditebak/di-brute-force).
-- Jalankan di Supabase SQL Editor. Aman dijalankan ulang.
-- =====================================================================

alter table users add column if not exists reset_password_token text;
alter table users add column if not exists reset_password_expires_at timestamptz;

create index if not exists idx_users_reset_token on users(reset_password_token);
