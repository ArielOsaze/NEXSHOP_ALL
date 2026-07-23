-- Banner promo terpisah buat mobile vs desktop.
-- Alasan: banner desktop biasa didesain rasio lebar (mis. 1600x600) yang
-- kalau di-crop paksa buat layar HP (biasanya butuh rasio 16:9) jadi keliatan
-- aneh/kepotong bagian pentingnya. Kalau mobile_image_url kosong, frontend
-- fallback pakai image_url yang sama kayak desktop (backward compatible,
-- slide lama yang belum diisi gambar mobile-nya tetap tampil normal).
alter table promo_slides add column if not exists mobile_image_url text;
