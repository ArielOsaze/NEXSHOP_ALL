-- =====================================================================
-- NexShop — migration: Settings, API Keys, dan Topup Diamond (TokoVoucher)
-- Jalankan di Supabase SQL Editor. Aman dijalankan ulang (pakai IF NOT EXISTS).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Pengaturan toko (nama toko, kontak, logo) — satu baris (id = 1)
-- ---------------------------------------------------------------------
create table if not exists store_settings (
    id int primary key default 1,
    store_name text default 'NexShop',
    tagline text default 'Play More. Pay Less.',
    contact_whatsapp text,
    contact_email text,
    logo_url text,
    updated_at timestamptz default now(),
    constraint single_row check (id = 1)
);
insert into store_settings (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 2) API Keys (Midtrans + TokoVoucher) — satu baris (id = 1)
-- Disimpan di DB supaya bisa diubah dari Settings di admin dashboard
-- tanpa perlu redeploy. Supabase URL/Service Key TETAP di .env saja
-- (karena dipakai untuk konek ke DB ini sendiri).
-- ---------------------------------------------------------------------
create table if not exists api_keys (
    id int primary key default 1,
    midtrans_server_key text,
    midtrans_client_key text,
    midtrans_is_production boolean default false,
    tokovoucher_member_code text,
    tokovoucher_secret text,
    updated_at timestamptz default now(),
    constraint single_row check (id = 1)
);
insert into api_keys (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 3) Produk Topup Diamond (di-sync dari TokoVoucher, dikurasi oleh admin)
-- ---------------------------------------------------------------------
create table if not exists topup_products (
    id bigserial primary key,
    kode_produk text unique not null,      -- kode di TokoVoucher, mis. "ML86"
    nama text not null,
    kategori text,                          -- mis. "Mobile Legends", "Free Fire"
    operator_logo text,
    deskripsi text,
    harga_beli numeric not null default 0,  -- harga modal dari TokoVoucher
    harga_jual numeric not null default 0,  -- harga jual ke customer (admin atur)
    butuh_server_id boolean default false,  -- true kalau produk perlu server ID (mis. ML)
    is_active boolean default false,        -- admin aktifkan manual sebelum tampil di toko
    sort_order int default 0,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

-- ---------------------------------------------------------------------
-- 4) Order Topup Diamond (terpisah dari tabel `orders` produk biasa)
-- ---------------------------------------------------------------------
create table if not exists topup_orders (
    id text primary key,                    -- mis. "TP" + timestamp
    user_id uuid,                           -- null kalau guest
    kode_produk text not null,
    nama_produk text,
    tujuan text not null,                   -- Player ID / User ID
    server_id text,                         -- opsional, tergantung produk
    recipient_email text,
    harga numeric not null,
    status text default 'pending',          -- pending | paid | processing | sukses | gagal | failed
    payment_method text default 'midtrans',
    snap_token text,
    payment_status text,                    -- status dari Midtrans (settlement/capture/dst)
    tv_ref_id text,                         -- ref_id yang dikirim ke TokoVoucher
    tv_trx_id text,                         -- trx_id balikan dari TokoVoucher
    tv_sn text,                             -- serial number / kode voucher hasil
    tv_message text,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

create index if not exists idx_topup_orders_user on topup_orders(user_id);
create index if not exists idx_topup_orders_status on topup_orders(status);
