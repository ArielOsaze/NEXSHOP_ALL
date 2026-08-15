# Regression Test Scripts

Simulasi logic (bukan E2E browser test — lihat §4B di
`LAPORAN_PERBAIKAN_BUG_POPUP_RATING.md` untuk kenapa).

- `sim.js` — poll() tidak loop lagi setelah status "paid" terdeteksi.
- `sim2.js` — menutup modal (X/backdrop/Escape) benar-benar menghentikan
  polling, popup tidak muncul lagi otomatis walau order akhirnya paid.
- `sim3_domcollision.js` — renderRatingPrompt (versi baru, container-scoped)
  tidak collision saat order sama dirender di 2 tempat sekaligus.
- `sim3b_prove_old_bug.js` — bukti bahwa kode LAMA (document.getElementById
  global) memang collision dalam skenario yang sama.
- `sim4_ratingbadge.js` — logic pemilihan badge "Beri Rating"/"Sudah Dinilai"
  di daftar Riwayat Saya, untuk semua kombinasi status/type/has_rating.
- `sim5_has_rating.js` — logic penambahan flag has_rating di getMyOrders
  (backend), memastikan order pending/failed dapat null, bukan true/false.
- `sim6_mojibake_check.js` — pastikan tidak ada karakter mojibake
  (â€¢/â€”/â€“/Ã/replacement char) tersisa di index.html. Jalankan dari
  dalam folder regtest/: `node sim6_mojibake_check.js`.

Jalankan: `node sim.js` dst (butuh Node.js, tidak perlu dependency untuk
sim.js/sim2.js/sim4.js/sim5.js; sim3_domcollision.js & sim3b butuh
`npm install jsdom`).
