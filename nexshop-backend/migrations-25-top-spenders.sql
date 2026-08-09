-- NexShop: Top Spenders / Hall of Fame (leaderboard manual entries).
-- Tabel ini belum pernah dibuat sebelumnya, padahal statsController.js
-- (getLeaderboard, getAdminLeaderboard, addTopSpender, updateTopSpender,
-- deleteTopSpender) sudah query ke sini sejak awal -- makanya menu
-- "Top Spenders (HoF)" di admin dashboard error/kosong.
-- Aman dijalankan ulang di Supabase SQL Editor.

create table if not exists public.top_spenders (
    id bigserial primary key,
    display_name text not null,
    total_spending numeric not null default 0,
    avatar_url text,
    badge text,
    rank integer not null default 99,
    is_active boolean not null default true,
    source text not null default 'manual',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_top_spenders_active_rank
    on public.top_spenders (is_active, rank);
