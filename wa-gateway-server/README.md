# NexShop WhatsApp Gateway

Service privat ini yang benar-benar menghubungkan NexShop ke WhatsApp Web melalui Baileys. Ia bukan bagian dari proses Express utama dan harus dijalankan sendiri pada host yang sama (default `127.0.0.1:8080`). Baileys adalah integrasi tidak resmi; gunakan hanya untuk pelanggan yang berhak menerima pesan dan patuhi ketentuan WhatsApp.

## Instalasi

1. Gunakan Node.js 20 atau lebih baru.
2. File `.env` **opsional**. Tanpa file itu gateway memakai folder data lokal yang diabaikan Git. Jika ingin session/config disimpan di volume khusus VPS, salin `.env.example` menjadi `.env` lalu atur `WA_AUTH_DIR` dan `WA_RUNTIME_CONFIG`; tidak perlu mengisi `WA_API_KEY`.
3. Jalankan `npm install` dari folder ini.
4. Jalankan `pm2 start ecosystem.config.cjs` lalu `pm2 save`.
5. Di Admin NexShop > Settings > API Keys, isi URL `http://127.0.0.1:8080`, lalu klik **Generate / Rotasi Key dari Dashboard**. Dashboard menyimpan key ke database backend dan file runtime gateway otomatis.
6. Scan QR yang muncul di card QR Scanner.

Jangan membuka port 8080 ke internet. Jika gateway berada di host lain, letakkan di belakang HTTPS dan batasi akses jaringan hanya dari backend NexShop.

## Endpoint internal

Semua endpoint berikut memerlukan header `X-API-Key`. Tidak ada endpoint bulk; setiap panggilan hanya mengirim satu nomor.

- `GET /health` — status koneksi dan QR.
- `GET /qr` — raw QR dan gambar data URL untuk dashboard admin.
- `POST /send-otp` — OTP atau pesan administratif tunggal.
- `POST /send-transaction` — notifikasi transaksi tunggal.
- `POST /send-message` — pesan tunggal untuk worker campaign NexShop.
- `POST /reset` — hapus sesi, lalu menghasilkan QR baru.

`POST /internal/configure` adalah bootstrap khusus tanpa `X-API-Key`, tetapi gateway menolaknya kecuali request benar-benar datang dari `127.0.0.1`/`::1` (backend NexShop pada VPS yang sama). Endpoint ini dipanggil tombol Dashboard dan tidak boleh dibuka melalui reverse proxy publik.

Folder `WA_AUTH_DIR` berisi kredensial WhatsApp jangka panjang. Batasi izinnya ke user service PM2 dan jangan commit atau kirimkan folder itu.
