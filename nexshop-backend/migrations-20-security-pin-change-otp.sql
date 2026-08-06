-- NexShop: wajibkan OTP email untuk perubahan Security PIN admin.
-- Aman dijalankan setelah migrations-18 pada database yang sudah ada.

alter table public.users
    add column if not exists security_pin_change_otp_hash text,
    add column if not exists security_pin_change_otp_expires_at timestamptz,
    add column if not exists security_pin_change_otp_attempts integer not null default 0,
    add column if not exists security_pin_change_otp_verified_at timestamptz;
