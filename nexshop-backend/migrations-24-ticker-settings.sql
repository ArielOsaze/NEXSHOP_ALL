-- NexShop: Ticker bar (marquee) settings — teks & kecepatan diatur dari admin.
-- Aman dijalankan ulang di Supabase SQL Editor.

alter table public.store_settings
    add column if not exists ticker_text text,
    add column if not exists ticker_speed_seconds integer not null default 30;

-- ticker_text disimpan sebagai baris terpisah dengan "|" sebagai pemisah, contoh:
-- "Transaksi aman dan cepat 24/7|Pembayaran QRIS & e-Wallet didukung|100% Legal & Terpercaya"
update public.store_settings
set ticker_text = 'Transaksi aman dan cepat 24/7|Pembayaran QRIS & e-Wallet didukung|100% Legal & Terpercaya|Customer Service siap membantu'
where id = 1 and (ticker_text is null or ticker_text = '');
