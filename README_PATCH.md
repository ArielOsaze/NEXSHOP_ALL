# NexBot RAG + Format + Kontak CS Patch

Struktur folder di zip ini SAMA PERSIS dengan struktur repo NexShop kamu.
Tinggal extract lalu timpa (overwrite) ke folder project asli:

nexshop-backend/controllers/aiController.js
nexshop-backend/controllers/settingsController.js
nexshop-backend/config/settings.js
nexshop-backend/migrations/005_add_contact_instagram_to_store_settings.sql   <- FILE BARU
nexshop-frontend/script.js
nexshop-frontend/style.css
nexshop-frontend/admin/dashboard.html
nexshop-frontend/admin/js/dashboard.js

## Langkah pasang
1. Extract zip ini, copy semua file ke lokasi yang sama persis di repo lokal kamu (timpa file lama).
2. Buka Supabase SQL Editor, jalankan isi file:
   nexshop-backend/migrations/005_add_contact_instagram_to_store_settings.sql
   (WAJIB sebelum restart backend, karena aiController.js sekarang baca kolom contact_instagram).
3. Deploy seperti biasa:
   git add . && git commit -m "fix: nexbot rag, format jawaban, kontak CS" && git push
   -> di VPS: git pull
   -> pm2 restart nexshop-backend --update-env

## Ringkasan perubahan

### aiController.js
- Nambah knowledge "Keamanan Bertransaksi di NexShop" -- biar pertanyaan
  "apakah NexShop aman?" nggak lagi kepecah ke 2 chunk lemah (Escrow +
  Legalitas) yang bikin AI ragu dan jatuh ke kalimat fallback.
- System prompt dibenerin: AI dilarang menilai ulang relevansi knowledge
  yang sudah dipilih sistem retrieval (sebelumnya ini bikin AI suka nolak
  jawab walau knowledge-nya ada).
- System prompt sekarang wajib pakai baris kosong antar paragraf + bullet
  list untuk poin/daftar/langkah -- ini yang benerin jawaban yang dulu
  numpuk jadi satu paragraf panjang.
- Tambah stripStrayFallback() -- jaring pengaman kalau AI kadang nyampur
  jawaban asli + kalimat fallback di respons yang sama (nyebabin tampil
  kayak 2 pesan padahal cuma 1 balasan AI).
- Tambah handleContactQuery() -- pertanyaan "hubungi CS/admin/kontak/
  sosmed/instagram/nomor wa" dijawab LANGSUNG dari store_settings (WA,
  Email, Instagram), TANPA lewat AI, jadi selalu akurat & sinkron sama
  halaman Contact Us.

### settings.js & settingsController.js
- Tambah field contact_instagram sebagai bagian resmi dari store_settings
  (bisa diatur dari Admin Dashboard, dan diekspos ke API publik /settings/store).

### script.js (frontend)
- parseMarkdownToHtml sekarang bisa render link markdown [teks](url) jadi
  <a> yang bisa diklik (dulu cuma bold/italic yang kepakai).
- Tombol "Hubungi CS WhatsApp" (muncul saat NexBot gagal jawab) sekarang
  ambil nomor WA dari store_settings, bukan nomor yang di-hardcode.
- Halaman Contact Us: Instagram sekarang ikut ke-update otomatis dari
  store_settings.contact_instagram (dulu hardcode di HTML).

### style.css
- Style link (warna cyan/violet sesuai tema) untuk <a> di dalam bubble
  chat NexBot.

### dashboard.html & dashboard.js (admin)
- Field baru "Instagram" di Settings > Toko, biar contact_instagram bisa
  diedit dari admin panel.

## Cek setelah deploy
- NexBot: "Apakah NexShop aman?" -> harus keluar jawaban utuh (bukan
  kalimat "belum tersedia di knowledge").
- NexBot: "Apakah NexShop legal?" -> jawaban sekarang harus kepecah jadi
  beberapa baris/paragraf, bukan 1 paragraf raksasa.
- NexBot: "hubungi CS" / "ada instagram?" -> keluar daftar WA/Email/IG
  dengan link yang bisa diklik.
- Admin Dashboard > Settings > Toko -> field Instagram ada & tersimpan.
- Halaman Kontak (footer/policy) -> Instagram ikut berubah sesuai yang
  disimpan di admin.
