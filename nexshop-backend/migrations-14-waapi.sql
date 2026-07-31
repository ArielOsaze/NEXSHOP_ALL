-- =====================================================================
-- NexShop — migration: WA Gateway (waapi.fyas.my.id) buat push notif
-- WhatsApp jadi bisa diatur dari Settings > API Keys di admin dashboard,
-- gak cuma dari .env. Jalankan di Supabase SQL Editor. Aman dijalankan ulang.
-- =====================================================================

alter table api_keys add column if not exists waapi_url text;
alter table api_keys add column if not exists waapi_key text;
alter table api_keys add column if not exists waapi_target_number text;
