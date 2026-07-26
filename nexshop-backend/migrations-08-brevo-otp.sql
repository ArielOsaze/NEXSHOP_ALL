-- =====================================================================
-- NexShop — migration: Brevo (email OTP/invoice) API key jadi bisa
-- diatur dari Settings > API Keys di admin dashboard, gak cuma dari .env.
-- Jalankan di Supabase SQL Editor. Aman dijalankan ulang.
-- =====================================================================

alter table api_keys add column if not exists brevo_api_key text;
alter table api_keys add column if not exists brevo_sender_email text;
alter table api_keys add column if not exists brevo_sender_name text;
