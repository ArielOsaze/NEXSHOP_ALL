-- =====================================================================
-- NexShop — migration: Urutan tampil untuk produk non-diamond (tabel `products`)
-- Jalankan di Supabase SQL Editor. Aman dijalankan ulang.
-- =====================================================================

-- sort_order dipakai buat nentuin urutan tampil produk di toko & admin.
-- Backfill pakai id yang ada sekarang, jadi urutan yang udah ada gak berubah
-- sebelum admin mulai ngatur ulang manual dari dashboard.
alter table products add column if not exists sort_order int;
update products set sort_order = id where sort_order is null;
alter table products alter column sort_order set default 0;

create index if not exists idx_products_sort_order on products(sort_order);
