-- Migration 024: optional TOTP 2FA for dedicated Portal Reseller accounts
--
-- Secret TOTP tidak pernah disimpan plaintext. secret_ciphertext berisi
-- AES-256-GCM (iv.tag.ciphertext dalam base64url); recovery code hanya hash.
-- enabled FALSE agar akun portal yang sudah ada tetap bisa login sampai pemilik
-- akun menyelesaikan setup dan verifikasi kode TOTP.

CREATE TABLE IF NOT EXISTS public.reseller_portal_2fa (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    portal_account_id UUID NOT NULL UNIQUE REFERENCES public.reseller_portal_accounts(id) ON DELETE CASCADE,
    secret_ciphertext TEXT NOT NULL,
    recovery_codes_hashes JSONB NOT NULL DEFAULT '[]'::jsonb,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT reseller_portal_2fa_recovery_codes_array_check
        CHECK (jsonb_typeof(recovery_codes_hashes) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_reseller_portal_2fa_enabled
    ON public.reseller_portal_2fa(enabled);
