-- Migration 015: profil identitas kanonis dan OTP nomor WhatsApp.
--
-- Aman untuk data lama: akun lama tetap dapat masuk. Nilai onboarding untuk
-- pengguna yang sudah ada hanya menjaga kompatibilitas akses; nomor lama TIDAK
-- diberi cap terverifikasi secara otomatis.

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_normalized TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_phone_normalized TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_purpose TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_attempts SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_sent_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_updated_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_count SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_window_started_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS login_locked_until TIMESTAMPTZ;

-- Backfill konservatif untuk format lama yang jelas. Jangan mengisi
-- phone_verified_at: adanya nomor historis bukan bukti kepemilikan nomor.
UPDATE users
SET phone_normalized = CASE
    WHEN regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') ~ '^08[0-9]{7,12}$'
        THEN '+62' || substring(regexp_replace(phone, '[^0-9]', '', 'g') FROM 2)
    WHEN regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') ~ '^628[0-9]{7,12}$'
        THEN '+' || regexp_replace(phone, '[^0-9]', '', 'g')
    ELSE NULL
END
WHERE phone_normalized IS NULL AND phone IS NOT NULL;

-- Pengguna sebelum migrasi tidak boleh terkunci dari aplikasi hanya karena
-- state onboarding ini baru ada. Checkout tetap meminta verifikasi nomor bila
-- belum tersedia.
UPDATE users
SET onboarding_completed = TRUE
WHERE onboarding_completed = FALSE AND email_verified = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_normalized_unique
    ON users (phone_normalized)
    WHERE phone_normalized IS NOT NULL AND phone_verified_at IS NOT NULL;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_otp_purpose_check;
ALTER TABLE users ADD CONSTRAINT users_otp_purpose_check
    CHECK (otp_purpose IS NULL OR otp_purpose IN ('email_verify', 'phone_onboarding', 'phone_change'));

COMMENT ON COLUMN users.phone_normalized IS 'Nomor WhatsApp kanonis E.164 (+628...), dipakai untuk identitas dan notifikasi akun.';
COMMENT ON COLUMN users.phone_verified_at IS 'Waktu pemilik akun membuktikan kontrol atas phone_normalized dengan OTP.';
