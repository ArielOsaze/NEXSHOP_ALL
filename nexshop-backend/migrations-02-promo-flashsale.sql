-- =====================================================================
-- NexShop — migration 2: Flash Sale pricing (coret harga) + Kode Promo
-- Jalankan di Supabase SQL Editor setelah migrations.sql. Aman diulang.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Flash Sale pricing di tabel produk yang sudah ada
--    strike_price = harga asli yang dicoret, price (kolom lama) = harga jual/promo
-- ---------------------------------------------------------------------
alter table products add column if not exists strike_price numeric;
alter table products add column if not exists is_flash_sale boolean default false;

-- ---------------------------------------------------------------------
-- 2) Kode Promo / Redeem Code
-- ---------------------------------------------------------------------
create table if not exists promo_codes (
    id bigserial primary key,
    code text unique not null,              -- selalu disimpan UPPERCASE
    description text,
    discount_type text not null default 'percent',  -- 'percent' | 'fixed'
    discount_value numeric not null default 0,       -- 10 (=10%) atau 15000 (=Rp15.000)
    max_discount numeric,                    -- cap maksimal potongan buat tipe percent (opsional)
    min_purchase numeric default 0,          -- minimal subtotal biar kode bisa dipakai
    max_uses int,                            -- null = tanpa batas
    used_count int default 0,
    is_active boolean default true,
    expires_at timestamptz,                  -- null = tanpa kadaluarsa
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

-- ---------------------------------------------------------------------
-- 3) Kolom tambahan di tabel orders buat catat kode promo yang dipakai
-- ---------------------------------------------------------------------
alter table orders add column if not exists promo_code text;
alter table orders add column if not exists discount_amount numeric default 0;
alter table orders add column if not exists subtotal numeric;
