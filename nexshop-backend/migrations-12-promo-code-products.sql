-- =====================================================================
-- NexShop — migration: Kode promo khusus produk tertentu
-- Jalankan di Supabase SQL Editor. Aman dijalankan ulang.
-- =====================================================================

-- null / [] (array kosong) = kode berlaku buat SEMUA produk (perilaku lama,
-- gak ada yang berubah buat kode promo yang udah ada).
-- Diisi array id produk, misal [12, 15, 20] = kode CUMA berlaku kalau
-- keranjang berisi salah satu produk itu, dan diskon cuma dihitung dari
-- harga produk-produk itu saja (bukan seluruh keranjang).
alter table promo_codes add column if not exists applicable_product_ids jsonb;
