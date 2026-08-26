# NexShop WhatsApp Gateway

Service privat ini yang benar-benar menghubungkan NexShop ke WhatsApp Web melalui Baileys. Ia bukan bagian dari proses Express utama dan harus dijalankan sendiri pada host yang sama (default `127.0.0.1:8080`). Baileys adalah integrasi tidak resmi; gunakan hanya untuk pelanggan yang berhak menerima pesan dan patuhi ketentuan WhatsApp.

## Instalasi

1. Gunakan Node.js 20 atau lebih baru.
2. Salin `.env.example` menjadi `.env`, lalu isi `WA_API_KEY` dengan secret acak minimal 24 karakter dan `WA_AUTH_DIR` dengan folder persisten di luar repo.
3. Jalankan `npm install` dari folder ini.
4. Jalankan `pm2 start ecosystem.config.cjs` lalu `pm2 save`.
5. Di Admin NexShop > Settings > API Keys, isi URL `http://127.0.0.1:8080` dan API key yang sama, simpan, lalu scan QR yang muncul.

Jangan membuka port 8080 ke internet. Jika gateway berada di host lain, letakkan di belakang HTTPS dan batasi akses jaringan hanya dari backend NexShop.

## Endpoint internal

Semua endpoint memerlukan header `X-API-Key`. Tidak ada endpoint bulk; setiap panggilan hanya mengirim satu nomor.

- `GET /health` — status koneksi dan QR.
- `GET /qr` — raw QR dan gambar data URL untuk dashboard admin.
- `POST /send-otp` — OTP atau pesan administratif tunggal.
- `POST /send-transaction` — notifikasi transaksi tunggal.
- `POST /send-message` — pesan tunggal untuk worker campaign NexShop.
- `POST /reset` — hapus sesi, lalu menghasilkan QR baru.

Folder `WA_AUTH_DIR` berisi kredensial WhatsApp jangka panjang. Batasi izinnya ke user service PM2 dan jangan commit atau kirimkan folder itu.
