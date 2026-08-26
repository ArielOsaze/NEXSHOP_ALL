-- Migration 020: harden OTP and password-reset delivery.
--
-- All user verification OTPs and password-reset links are server-enforced for
-- five minutes. Existing reset tokens are invalidated during the cutover so a
-- token created under the old 30-minute policy cannot survive deployment.

ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_password_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_password_expires_at TIMESTAMPTZ;

UPDATE users
SET otp_code = NULL,
    otp_expires_at = NULL,
    otp_purpose = NULL,
    otp_attempts = 0,
    otp_sent_at = NULL
WHERE otp_code IS NOT NULL
   OR otp_expires_at IS NOT NULL;

UPDATE users
SET reset_password_token = NULL,
    reset_password_expires_at = NULL
WHERE reset_password_token IS NOT NULL
   OR reset_password_expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_reset_password_token
    ON users (reset_password_token)
    WHERE reset_password_token IS NOT NULL;

-- Keep the persisted default/custom OTP copy aligned with the server policy.
-- The server remains the source of truth for expiry; this prevents a stale
-- dashboard template from telling users that an OTP lasts longer.
UPDATE store_settings
SET wa_template_otp = regexp_replace(wa_template_otp, '[0-9]+[[:space:]]+menit', '5 menit', 'gi')
WHERE wa_template_otp IS NOT NULL;

COMMENT ON COLUMN users.reset_password_token IS 'SHA-256 hash of a single-use password-reset token; raw token is delivered only via trusted channel.';
COMMENT ON COLUMN users.reset_password_expires_at IS 'Password-reset token expiry; server policy is five minutes.';
