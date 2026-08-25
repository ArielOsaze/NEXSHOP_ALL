-- Migration 013: tautkan akun NexShop dengan provider login eksternal.
--
-- Hanya subject ID Google yang disimpan. Access token, refresh token, dan
-- profil Google tidak disimpan di database NexShop.

ALTER TABLE users ADD COLUMN IF NOT EXISTS google_subject TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider TEXT NOT NULL DEFAULT 'password';

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_auth_provider_check;
ALTER TABLE users ADD CONSTRAINT users_auth_provider_check
    CHECK (auth_provider IN ('password', 'google', 'password_google'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_subject_unique
    ON users (google_subject)
    WHERE google_subject IS NOT NULL;
