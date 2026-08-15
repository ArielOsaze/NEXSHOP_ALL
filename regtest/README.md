# Regression Test Scripts

Simulasi logic terisolasi (bukan E2E browser test) kecuali disebutkan lain.

- `sim.js` — poll() tidak loop lagi setelah status "paid" terdeteksi.
- `sim2.js` — menutup modal (X/backdrop/Escape) benar-benar menghentikan
  polling, popup tidak muncul lagi otomatis walau order akhirnya paid.
- `sim3_domcollision.js` — renderRatingPrompt (versi baru, container-scoped)
  tidak collision saat order sama dirender di 2 tempat sekaligus.
- `sim3b_prove_old_bug.js` — bukti bahwa kode LAMA (document.getElementById
  global) memang collision dalam skenario yang sama.
- `sim4_ratingbadge.js` — logic pemilihan badge "Beri Rating"/"Sudah Dinilai"
  di daftar Riwayat Saya, untuk semua kombinasi status/type/has_rating
  (order MAUPUN topup — topup rating ditambahkan Agustus 2026).
- `sim5_has_rating.js` — logic penambahan flag has_rating di getMyOrders
  (backend), memastikan order pending/failed dapat null, bukan true/false.
- `sim6_mojibake_check.js` — pastikan tidak ada karakter mojibake
  (â€¢/â€”/â€“/Ã/replacement char) tersisa di index.html. Jalankan dari
  dalam folder regtest/: `node sim6_mojibake_check.js`.
- `sim7_testimonial_rows.js` — logic split/pad/duplikasi baris marquee
  testimoni ("Apa Kata Mereka"), termasuk edge case cuma 1 testimoni
  (pastikan tidak infinite loop).
- `sim8_ssr_sitemap_fixes.js` — perbaikan di ssrController.js
  (halaman 404 tetap pakai template utuh, bukan fragmen polos) dan
  sitemapController.js (XML escaping, baseUrl konsisten pakai FRONTEND_URL).

Jalankan: `node simN_xxx.js` dari dalam folder ini. Semua di atas TIDAK
butuh Node modules tambahan kecuali sim3_domcollision.js & sim3b (butuh
`npm install jsdom` sekali di folder regtest/).

## test_ssr.js — BEDA dari yang lain

`test_ssr.js` BUKAN simulasi logic — ini integration test sungguhan yang:
- Menjalankan server Express lokal beneran.
- Konek ke database Supabase ASLI (pakai kredensial di nexshop-backend/.env).
- Meng-INSERT dan MENGHAPUS satu baris dummy di tabel `news_articles` asli
  (untuk test XSS-escaping).

**Jangan jalankan ini terhadap database production** kecuali kamu benar-benar
paham konsekuensinya (baris dummy dihapus lagi di akhir test kalau berhasil,
tapi kalau test gagal di tengah jalan sebelum baris cleanup jalan, baris
dummy itu bisa tertinggal). Paling aman dijalankan terhadap database
staging/development, bukan production.
