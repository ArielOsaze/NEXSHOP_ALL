-- =====================================================================
-- NexShop — migration 3: Notifikasi Admin (aktivitas & keamanan)
-- Jalankan di Supabase SQL Editor setelah migration 1 & 2. Aman diulang.
-- =====================================================================

create table if not exists admin_notifications (
    id bigserial primary key,
    type text not null,              -- 'order' | 'topup' | 'product' | 'promo' | 'promo_code' | 'settings' | 'security'
    message text not null,
    is_read boolean default false,
    created_at timestamptz default now()
);

create index if not exists idx_admin_notifications_created on admin_notifications(created_at desc);
create index if not exists idx_admin_notifications_unread on admin_notifications(is_read) where is_read = false;
