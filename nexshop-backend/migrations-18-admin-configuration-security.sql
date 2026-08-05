-- NexShop: Admin Configuration Center + Security PIN.
-- Jalankan setelah migration sebelumnya. Aman dijalankan ulang di Supabase SQL Editor.
-- SUPABASE_URL dan SUPABASE_SERVICE_KEY tetap merupakan bootstrap environment
-- backend: koneksi ke database harus ada sebelum konfigurasi tersimpan ini bisa dibaca.

alter table public.users
    add column if not exists security_pin_hash text,
    add column if not exists security_pin_updated_at timestamptz;

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
