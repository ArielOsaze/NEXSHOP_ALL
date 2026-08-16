-- Tambah kolom contact_instagram ke store_settings, supaya halaman Contact Us
-- dan NexBot (fitur "Hubungi Customer Service") sama-sama baca dari satu
-- sumber data yang sama, dan bisa diedit dari Admin Dashboard > Settings.
ALTER TABLE store_settings
    ADD COLUMN IF NOT EXISTS contact_instagram TEXT DEFAULT '';

-- Opsional: isi nilai awal dengan Instagram yang sekarang sudah tampil
-- (hardcode) di halaman Contact Us, supaya nggak kosong setelah migrasi.
UPDATE store_settings
SET contact_instagram = 'nexshop_id'
WHERE id = 1 AND (contact_instagram IS NULL OR contact_instagram = '');
