-- Migration 023: Dedicated Partner Portal identities
--
-- Portal Reseller TIDAK memakai kredensial akun storefront. Setiap pendaftar
-- membuat identity portal sendiri; identity internalnya ditandai portal_only
-- sehingga password portal tidak dapat dipakai masuk toko utama.
-- Jalankan file ini manual di Supabase SQL Editor sebelum mengaktifkan flow baru.

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS account_scope TEXT NOT NULL DEFAULT 'storefront';

ALTER TABLE public.users
    DROP CONSTRAINT IF EXISTS users_account_scope_check;

ALTER TABLE public.users
    ADD CONSTRAINT users_account_scope_check
    CHECK (account_scope IN ('storefront', 'portal_only'));

CREATE TABLE IF NOT EXISTS public.reseller_portal_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id BIGINT NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT reseller_portal_accounts_status_check
        CHECK (status IN ('pending', 'approved', 'rejected', 'suspended'))
);

CREATE INDEX IF NOT EXISTS idx_reseller_portal_accounts_status
    ON public.reseller_portal_accounts(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reseller_portal_accounts_email
    ON public.reseller_portal_accounts(lower(email));
