-- =====================================================================
-- NexShop — migration 4: Migrasi Midtrans → iPaymu + halaman FAQ/Kontak/
-- Syarat & Ketentuan/Refund yang bisa diatur dari admin dashboard +
-- logo diamond per item topup.
-- Jalankan di Supabase SQL Editor setelah migration 1, 2, 3. Aman diulang.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Ganti kolom Midtrans di api_keys jadi iPaymu (VA + API Key)
-- ---------------------------------------------------------------------
alter table api_keys add column if not exists ipaymu_va text;
alter table api_keys add column if not exists ipaymu_api_key text;
alter table api_keys add column if not exists ipaymu_is_production boolean default false;

-- Kolom midtrans_* lama TIDAK dihapus otomatis (biar aman kalau kamu masih
-- butuh datanya buat referensi). Setelah yakin migrasi ke iPaymu beres,
-- boleh dihapus manual:
-- alter table api_keys drop column if exists midtrans_server_key;
-- alter table api_keys drop column if exists midtrans_client_key;
-- alter table api_keys drop column if exists midtrans_is_production;

-- ---------------------------------------------------------------------
-- 2) store_settings — alamat & telepon usaha (WAJIB sama dengan yang
--    didaftarkan di iPaymu), plus konten FAQ / Syarat & Ketentuan /
--    Kebijakan Refund yang semuanya bisa diedit dari admin dashboard.
-- ---------------------------------------------------------------------
alter table store_settings add column if not exists address text;
alter table store_settings add column if not exists contact_phone text;
alter table store_settings add column if not exists faq jsonb default '[]'::jsonb;
alter table store_settings add column if not exists terms_content text;
alter table store_settings add column if not exists refund_content text;

-- Isi default (aman diulang, cuma jalan kalau address masih kosong)
update store_settings set
    address = coalesce(address, 'Jl. Siroto, Villa P4A, Pudakpayung, Banyumanik, Semarang'),
    contact_phone = coalesce(contact_phone, contact_whatsapp)
where id = 1;

-- ---------------------------------------------------------------------
-- 3) Kolom pembayaran generik (gak lagi spesifik "snap_token" Midtrans)
-- ---------------------------------------------------------------------
alter table orders add column if not exists payment_url text;
alter table orders add column if not exists ipaymu_session_id text;

alter table topup_orders add column if not exists payment_url text;
alter table topup_orders add column if not exists ipaymu_session_id text;

-- ---------------------------------------------------------------------
-- 4) Logo diamond per item (beda dari operator_logo yang dipakai buat
--    logo GAME/kategori) — supaya tiap denominasi diamond bisa punya
--    ikon sendiri, semua diupload & diedit dari admin dashboard.
-- ---------------------------------------------------------------------
alter table topup_products add column if not exists item_icon text;

-- ---------------------------------------------------------------------
-- 5) FAQ contoh awal (boleh diedit/dihapus/ditambah dari admin dashboard)
-- ---------------------------------------------------------------------
update store_settings set faq = '[
  {"q": "Berapa lama proses pesanan?", "a": "Umumnya beberapa menit, maksimal 24 jam pada jam kerja tergantung ketersediaan stok."},
  {"q": "Metode pembayaran apa saja yang tersedia?", "a": "Semua metode yang disediakan iPaymu: QRIS, Virtual Account/Transfer Bank, E-Wallet, dan Kartu Kredit/Debit."},
  {"q": "Bagaimana jika Diamond/Voucher belum masuk setelah bayar?", "a": "Tunggu maksimal 24 jam. Jika belum masuk juga, hubungi admin lewat WhatsApp/email di halaman Kontak dengan menyertakan Order ID."},
  {"q": "Apakah bisa refund kalau salah input ID?", "a": "Tidak. Refund tidak berlaku untuk kesalahan input ID/Server dari pembeli. Selengkapnya di halaman Kebijakan Refund."}
]'::jsonb
where id = 1 and (faq is null or faq = '[]'::jsonb);
