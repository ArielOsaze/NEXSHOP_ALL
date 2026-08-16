-- ============================================================================
-- Migration: show_name di order_ratings & topup_ratings
-- Jalankan manual di Supabase SQL Editor (Project > SQL Editor > New query).
--
-- Sebelumnya nama pembeli SELALU disamarkan otomatis (maskPublicName) di
-- getPublicTestimonials tanpa pembeli bisa memilih. Kolom baru ini menyimpan
-- preferensi eksplisit pembeli saat submit rating: true = tampilkan nama
-- asli apa adanya di testimoni publik, false/default = tetap disamarkan
-- seperti sebelumnya. Default false supaya perilaku lama (privasi aman by
-- default) tidak berubah untuk rating yang sudah ada / kalau frontend lupa
-- mengirim field ini.
-- ============================================================================

alter table public.order_ratings
    add column if not exists show_name boolean not null default false;

alter table public.topup_ratings
    add column if not exists show_name boolean not null default false;
