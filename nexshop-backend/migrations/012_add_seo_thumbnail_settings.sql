-- Konfigurasi runtime thumbnail SEO yang dapat diubah dari Admin Dashboard.
-- Nilai .env tetap dipakai sebagai fallback bila kolom ini kosong.
ALTER TABLE store_settings
    ADD COLUMN IF NOT EXISTS seo_screenshot_base_url TEXT,
    ADD COLUMN IF NOT EXISTS chrome_executable_path TEXT;

COMMENT ON COLUMN store_settings.seo_screenshot_base_url IS
    'Origin frontend publik untuk screenshot Open Graph, mis. https://nexshop.cloud';
COMMENT ON COLUMN store_settings.chrome_executable_path IS
    'Path absolut Chrome/Chromium pada host backend, mis. /usr/bin/google-chrome-stable';
