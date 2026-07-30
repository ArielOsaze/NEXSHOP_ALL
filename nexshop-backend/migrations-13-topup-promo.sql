-- =====================================================================
-- NexShop — migration 13: dukungan kode promo di checkout topup diamond
-- Jalankan di Supabase SQL Editor. Aman dijalankan ulang.
-- =====================================================================

-- subtotal = harga_jual produk SEBELUM diskon (harga dulu disimpan di
-- kolom `harga`, sekarang `harga` dipakai buat TOTAL SETELAH diskon,
-- biar konsisten sama semua tempat lain yang udah baca `harga` sebagai
-- "total yang harus/sudah dibayar").
alter table topup_orders add column if not exists subtotal numeric;
alter table topup_orders add column if not exists discount_amount numeric default 0;
alter table topup_orders add column if not exists promo_code text;

-- Isi subtotal buat data lama (order sebelum migrasi ini) = harga saat ini,
-- karena order-order itu belum ada konsep diskon sama sekali.
update topup_orders set subtotal = harga where subtotal is null;
