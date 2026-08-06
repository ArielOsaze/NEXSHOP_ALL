-- NexShop: Admin Configuration Center + Security PIN.
-- Jalankan setelah migration sebelumnya. Aman dijalankan ulang di Supabase SQL Editor.
-- SUPABASE_URL dan SUPABASE_SERVICE_KEY tetap merupakan bootstrap environment
-- backend: koneksi ke database harus ada sebelum konfigurasi tersimpan ini bisa dibaca.

alter table public.users
    add column if not exists security_pin_hash text,
    add column if not exists security_pin_updated_at timestamptz,
    add column if not exists security_pin_change_otp_hash text,
    add column if not exists security_pin_change_otp_expires_at timestamptz,
    add column if not exists security_pin_change_otp_attempts integer not null default 0,
    add column if not exists security_pin_change_otp_verified_at timestamptz;

-- Audit hanya dapat diakses backend menggunakan service_role.
create table if not exists public.admin_security_audit_logs (
    id bigint generated always as identity primary key,
    admin_id bigint not null,
    admin_email text,
    admin_username text,
    ip_address text,
    user_agent text,
    action text not null,
    details jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);
create index if not exists admin_security_audit_logs_created_at_idx on public.admin_security_audit_logs (created_at desc);
alter table public.admin_security_audit_logs enable row level security;
revoke all on table public.admin_security_audit_logs from anon, authenticated;
grant select, insert on table public.admin_security_audit_logs to service_role;

-- Konfigurasi event reusable yang aman dikirim ke storefront.
alter table public.store_settings add column if not exists event_mascot jsonb;

alter table public.api_keys
    add column if not exists gemini_api_key text,
    add column if not exists gemini_news_model text,
    add column if not exists smtp_host text,
    add column if not exists smtp_port integer,
    add column if not exists smtp_user text,
    add column if not exists smtp_password text,
    add column if not exists smtp_from_email text,
    add column if not exists smtp_from_name text;

update public.api_keys
set gemini_news_model = coalesce(nullif(btrim(gemini_news_model), ''), 'gemini-2.5-flash')
where id = 1;

-- Konfigurasi ini hanya pernah dibaca backend menggunakan service_role.
alter table public.api_keys enable row level security;
revoke all on table public.api_keys from anon, authenticated;
grant select, insert, update, delete on table public.api_keys to service_role;
