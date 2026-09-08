-- Migration 029: one-time WhatsApp password reset for dedicated reseller portal accounts.
-- Apply manually in Supabase SQL Editor after migration 023.
-- Raw reset tokens are never stored; only a SHA-256 digest is persisted.

ALTER TABLE public.reseller_portal_accounts
    ADD COLUMN IF NOT EXISTS reset_password_token TEXT,
    ADD COLUMN IF NOT EXISTS reset_password_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_reseller_portal_reset_password_token
    ON public.reseller_portal_accounts (reset_password_token)
    WHERE reset_password_token IS NOT NULL;

COMMENT ON COLUMN public.reseller_portal_accounts.reset_password_token IS
    'SHA-256 hash of a single-use Portal password reset token.';
COMMENT ON COLUMN public.reseller_portal_accounts.reset_password_expires_at IS
    'Portal password reset token expiry; server policy is five minutes.';
