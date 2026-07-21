-- =====================================================================
-- NexShop — migration 5: Kolom kredensial ApiGames (buat fitur "Cek Akun"
-- otomatis di halaman Topup — Mobile Legends & Free Fire). Kolom ini
-- sebelumnya dipakai oleh backend (config/settings.js, config/apigames.js)
-- tapi belum pernah dibuatkan migration-nya, jadi selama ini tidak pernah
-- benar-benar tersimpan di database.
-- Jalankan di Supabase SQL Editor setelah migration 1-4. Aman diulang.
-- =====================================================================

alter table api_keys add column if not exists apigames_merchant_id text;
alter table api_keys add column if not exists apigames_secret_key text;
