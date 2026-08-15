# Laporan Audit & Perbaikan Bug — Popup Order/Rating NexShop

## 1. Ringkasan Masalah
- Setelah pembayaran sukses, popup "Cek Transaksi / Rating" kadang tidak
  konsisten muncul.
- Saat popup ditutup dengan tombol **X**, popup bisa **muncul lagi secara
  otomatis** atau **loop terus-menerus**.
- (Susulan) Pastikan user tetap bisa memberi rating lewat "Riwayat Saya"
  kalau terlewat saat popup sukses — seperti Shopee.

## 2. Root Cause (bukan workaround, ini akar masalahnya)

Semua bug loop/reopen berasal dari **satu mekanisme polling** yang dipakai
untuk mendeteksi status pembayaran real-time: `ipaymuPollingTimeout` /
`ipaymuPollingController` di `nexshop-frontend/script.js`, dipakai oleh dua
fungsi: `showDirectPaymentModal()` (flow QRIS/VA) dan `openIpaymuPopup()`
(flow redirect/popup iPaymu).

### 2a-1. Loop tak berhenti setelah status "paid" terdeteksi
Di dalam `poll()`, setelah status `"paid"`/`"sukses"` terdeteksi, kode
memanggil `showPaidOrderSuccess()` (yang membuka `checkoutOverlay` berisi
rating) — **tapi tidak ada `return`**. Akibatnya eksekusi tetap jatuh ke baris
terakhir `ipaymuPollingTimeout = setTimeout(poll, 3000)`, sehingga 3 detik
kemudian `poll()` jalan lagi, status masih `"paid"`, dan
`showPaidOrderSuccess()` (yang me-reopen `checkoutOverlay` lewat
`openOverlay()`) **dipanggil ulang** — begitu terus setiap 3 detik selamanya.
Ini adalah penyebab **"loop terus-menerus"**.

### 2a-2. Tombol X tidak menghentikan polling (hanya di flow QRIS/VA)
`showDirectPaymentModal()` punya `handleClose()` untuk tombol X
(`dpCloseBtn`), tapi fungsi itu **hanya** memanggil `closeOverlay()` dan reset
tombol — **tidak pernah** `clearTimeout(ipaymuPollingTimeout)` maupun
`ipaymuPollingController.abort()`. (Bandingkan dengan `openIpaymuPopup()` yang
sudah melakukan ini dengan benar sebelumnya). Jadi walau modal QRIS/VA sudah
ditutup lewat X, polling tetap berjalan di background, dan begitu status
akhirnya `"paid"` (dari webhook), 2a-1 memicu `checkoutOverlay` (popup sukses
& rating) **muncul otomatis** — padahal user sudah eksplisit menutup modal
pembayaran. Ini adalah penyebab **"popup muncul lagi setelah ditutup X"**.

### 2a-3. Backdrop-click & Escape juga bypass close handler
Modal `directPaymentOverlay` dan `paymentWaitingOverlay` sama-sama pakai class
`.overlay` global, yang juga bisa ditutup lewat **klik backdrop** atau tombol
**Escape** — dua jalur ini memanggil `closeOverlay(id)` **langsung**, tanpa
lewat `handleClose()` milik masing-masing fungsi. Sebelum audit ini, kedua
jalur close tersebut sama sekali tidak menghentikan polling — sehingga bug
yang sama (popup reopen) juga bisa terjadi walau user menutup modal bukan
lewat tombol X. (Ditemukan saat audit, belum sempat jadi laporan user.)

### 2b. Token kadaluarsa memblokir checkout & rating (backend)
`nexshop-backend/middleware/optionalAuthMiddleware.js` dipakai di endpoint
yang seharusnya boleh diakses **guest maupun user login** (checkout order,
checkout topup, cek eligibility rating, submit rating, AI chat). Tapi kalau
ada token di header Authorization dan token itu **tidak valid/kadaluarsa**,
middleware ini langsung `return res.status(401)` — menolak request
**sepenuhnya**, bukan fallback ke mode guest.

Token JWT di app ini kadaluarsa otomatis dalam **7 hari**
(`authController.js`, `expiresIn: "7d"`), tapi frontend **tidak pernah**
menghapus token dari `localStorage` secara otomatis saat kadaluarsa — hanya
dihapus saat user klik tombol Logout secara eksplisit. Jadi user yang pernah
login lalu kembali ke situs setelah >7 hari akan selalu mengirim token basi,
dan:
1. **Checkout gagal total** (baik beli produk maupun topup) dengan pesan
   "Token tidak valid" — padahal endpoint ini seharusnya tetap jalan sebagai
   guest.
2. **Cek eligibility rating gagal (401)** — `renderRatingPrompt()` di
   frontend diam-diam `console.warn` dan `return` tanpa menampilkan apa pun,
   sehingga **form rating tidak pernah muncul** walau order berstatus
   `paid`. Ini match langsung dengan laporan "rating harus muncul dengan
   benar".

**Perbaikan**: token yang invalid/kadaluarsa/format salah sekarang
diperlakukan sama seperti tidak ada token — `req.user = null`, request tetap
diproses sebagai guest (`next()`), bukan ditolak. Ini tidak mengurangi
keamanan: `jwt.verify()` yang gagal tetap berarti `req.user` tidak pernah
diisi dari token yang tak terpercaya (tidak ada celah spoofing identitas) —
satu-satunya perubahan adalah request tetap jalan sebagai anonymous alih-alih
diblokir. Endpoint yang memang wajib login ketat (`/orders/my`, semua route
admin) tetap memakai `authMiddleware` biasa yang tidak diubah.

### 2c. ID collision pada form rating (frontend)
`renderRatingPrompt()` membuat id elemen berbasis `orderId`
(`rp_form_<uid>`, `rp_err_<uid>`, dst.) lalu mengambilnya kembali dengan
`document.getElementById(...)` — pencarian **global** di seluruh dokumen.
Karena `uid` hanya berbasis Order ID (bukan per-container), kalau order yang
sama pernah dirender rating-nya di **dua tempat sekaligus** — misalnya popup
sukses checkout masih terbuka, lalu user juga membuka "Cek Transaksi" dan
memasukkan Order ID yang sama — akan ada dua elemen dengan id yang identik
di DOM. `document.getElementById()` hanya mengembalikan elemen **pertama**
yang match, sehingga interaksi (klik bintang, kirim rating) di modal kedua
bisa salah sasaran memanipulasi elemen milik modal pertama.

**Perbaikan**: semua lookup di `renderRatingPrompt()` diganti dari
`document.getElementById(...)` menjadi `container.querySelector(...)`, jadi
selalu scoped ke container-nya sendiri, terlepas dari id yang sama muncul di
tempat lain. Dibuktikan dengan test DOM (jsdom) — lihat §4.

### 2d. Fitur "Rate via Riwayat" (mirip Shopee) — sudah ada, tapi tidak terlihat
User menanyakan apakah rating masih bisa diberikan lewat "Riwayat Saya" kalau
terlewat saat popup sukses (persis seperti Shopee — order yang belum dinilai
tetap bisa dinilai dari daftar riwayat).

**Kabar baik**: mekanismenya **sudah ada** sejak awal — klik item pesanan di
tab "Riwayat Saya" akan membuka detail order di tab "Cek Transaksi", dan
`renderTrackResult()` sudah otomatis menampilkan form rating (lewat
`renderRatingPrompt()`, backend sebagai source of truth) kalau order tersebut
`paid` dan belum dirating. Ini juga sudah diperkuat oleh fix ID-collision di
§2c, sehingga aman dipakai bersamaan dengan popup lain.

**Tapi ada gap nyata**: daftar "Riwayat Saya" **tidak pernah menunjukkan**
mana order yang masih butuh rating dan mana yang sudah — user harus buka
satu-satu untuk tahu. Beda dengan Shopee yang selalu kasih badge/tombol
"Beri Penilaian" langsung di kartu pesanan. Ini bukan bug yang bikin fitur
gagal total, tapi bikin fitur ini nyaris tidak kepakai di praktiknya karena
tidak ada yang menuntun user ke situ.

**Perbaikan (fitur, bukan cuma bug fix)**:
- **Backend** (`orderController.js`, `getMyOrders`): tambah 1 query
  batch (bukan N+1) ke `order_ratings` untuk semua order `paid` milik user,
  lalu sertakan flag `has_rating: true/false/null` per order (`null` untuk
  order yang belum `paid`, karena tidak relevan dinilai).
- **Frontend** (`loadMyTransactions()` di `script.js`): setiap order `paid`
  di daftar riwayat sekarang dapat badge kecil — **"☆ Beri Rating"**
  (kuning, kalau `has_rating === false`) atau **"★ Sudah Dinilai"** (abu-abu,
  kalau `has_rating === true`) — persis pola Shopee. Topup tidak dapat badge
  ini karena topup memang tidak punya sistem rating (sesuai desain backend
  yang sudah ada, tidak diubah).
- CSS baru `.track-mine-rating-badge` (`style.css`) — class terpisah dari
  `.track-status-badge` supaya tidak ikut `margin-bottom:12px` yang didesain
  untuk header di halaman detail, bukan badge kecil di dalam list item.

### 2e. Kenapa topup tidak punya rating — konfirmasi, bukan bug
Ditanyakan user: apakah topup memang tidak punya rating? **Ya, dan ini
memang desain sejak awal, bukan bug/oversight** — dikonfirmasi secara
struktural, bukan cuma dugaan:
- Tabel `order_ratings` (dipakai `ratingController.js`) foreign-key ke
  `orders`, dan `checkEligibility`/`submitRating` **cuma query ke tabel
  `orders`** — sama sekali tidak menyentuh `topup_orders`. Kalau Order ID
  yang dicek adalah ID topup, query ke `orders` akan `maybeSingle()` return
  `null` → 404 "Pesanan tidak ditemukan".
- Tidak ada tabel `topup_ratings`, tidak ada route rating untuk topup, tidak
  ada referensi topup-rating di admin dashboard mana pun di codebase.
- Frontend (`renderRatingPrompt`) secara eksplisit `if (orderData.type ===
  "topup") return;` sebelum manapun logic rating lain jalan.

Jadi ini bukan setengah-jalan/kelupaan — infrastrukturnya memang cuma
dibangun untuk order produk (yang diproses manual admin, wajar dinilai
kualitas layanannya), bukan untuk topup diamond/voucher (yang biasanya
otomatis lewat provider seperti TokoVoucher, tanpa variasi kualitas layanan
untuk dinilai). **Saya belum menambahkan rating untuk topup** karena itu
fitur baru (tabel baru/kolom baru, endpoint baru, UI baru) — bukan bug fix —
dan butuh keputusan produk, bukan sesuatu yang bisa saya asumsikan sendiri.
Kalau memang mau ditambahkan, kabari saya dan saya bisa desain & build itu
sebagai pekerjaan terpisah.

### 2f. Bug Teks — karakter mojibake (encoding rusak) di beberapa tempat
User melaporkan melihat huruf anomali di bagian S&K dkk. Dikonfirmasi:
**bug nyata**, ditemukan di `nexshop-frontend/index.html` — 15 kemunculan di
6 baris. Ini karakter *mojibake* klasik: teks yang aslinya UTF-8 (dash,
bullet) sempat dibaca-ulang seolah Windows-1252/Latin-1 lalu disimpan ulang
sebagai UTF-8 — biasa terjadi kalau teks di-copy-paste dari Word/editor lain
dengan encoding berbeda. Lokasi:
- **Halaman Syarat & Ketentuan** (poin larangan alih kredensial): `izin â€”
  pelanggaran` → seharusnya em dash: `izin — pelanggaran`
- **Halaman Kebijakan Refund** (estimasi proses): `3â€“14 hari` → seharusnya
  en dash: `3–14 hari`
- **Placeholder password login**: `placeholder="â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢"` →
  seharusnya bullet: `••••••••` (field password lain di halaman yang sama
  sudah pakai teks placeholder biasa seperti "Minimal 8 karakter", jadi ini
  satu-satunya field yang kena)
- **Catatan checkout tanpa akun**: `setelah bayar â€” gak tersimpan` →
  `setelah bayar — gak tersimpan`
- 2 kemunculan lain ada di **komentar HTML** (`<!-- STEP 1 â€” ... -->`) —
  tidak terlihat user, tapi tetap dibersihkan untuk kerapian kode.

**Perbaikan**: seluruh 15 kemunculan diganti ke karakter yang benar
(em dash U+2014, en dash U+2013, bullet U+2022). Sudah diverifikasi file
tetap UTF-8 valid, jumlah baris (1092) dan line-ending (CRLF) tidak berubah
setelah perbaikan (lihat §4).

Saya juga scan **seluruh proyek** (semua `.html`/`.js`/`.css`, termasuk
admin dashboard & backend) untuk pola mojibake serupa (`Ã`, `â€`, non-UTF-8,
replacement character U+FFFD) — **tidak ada lagi** yang ditemukan di luar
`index.html`. Catatan: ada 2 file lama yang encoding-nya UTF-16 (bukan
mojibake, cuma encoding beda) — `current_index.html` di root proyek dan
`_archive/old_script.js` — tapi keduanya **backup/arsip yang tidak dipakai
sama sekali oleh aplikasi live** (tidak direferensikan file manapun), jadi
tidak saya sentuh. FAQ list, kebijakan legalitas, dan info kontak yang
tampil di modal yang sama diisi **dinamis dari database** (lewat
`/api/settings/store`, dikelola admin) — di luar jangkauan audit kode
statis ini; kalau ada karakter aneh di sana juga, kemungkinan besar
sumbernya sama (copy-paste encoding salah) dan perlu diedit ulang dari
panel admin.

> Rating engine intinya (backend `ratingController.js`, endpoint
> `/ratings/eligibility/:orderId`, dan alur fetch→render→submit di
> `renderRatingPrompt()`) **sudah benar sejak awal** — backend selalu jadi
> source of truth untuk eligibility. Semua bug rating yang ditemukan (§2b,
> §2c) ada di lapisan "kapan/di mana form-nya bisa muncul & berfungsi benar",
> bukan di logic penilaian itu sendiri — jadi logic inti tidak disentuh.

## 3. Perbaikan yang Dilakukan (root cause fix, bukan patch tempel)

### 3a. Loop popup / muncul lagi setelah ditutup (§2a)
Semua perubahan di `nexshop-frontend/script.js`:

1. **`stopIpaymuPolling()`** — fungsi terpusat baru (dekat deklarasi
   `ipaymuPollingTimeout`) yang menghentikan timer, meng-abort controller
   fetch, menutup popup window iPaymu (jika ada, lewat variabel global baru
   `ipaymuActivePopupWindow`), dan mereset tombol "Bayar Sekarang". Dipakai
   di semua jalur close (`handleClose()` di kedua fungsi payment) supaya
   perilakunya konsisten dan tidak ada logic yang terduplikasi/berbeda-beda.

2. **`closeOverlay(id)`** — ditambah pemanggilan `stopIpaymuPolling()` khusus
   untuk `id === "directPaymentOverlay" || id === "paymentWaitingOverlay"`.
   Ini menutup celah §2a-3: sekarang **semua jalur penutupan** (tombol X,
   klik backdrop, tombol Escape) benar-benar menghentikan polling — bukan
   hanya tombol X.

3. **`poll()` di `showDirectPaymentModal()` dan `openIpaymuPopup()`** —
   ditambahkan `return` setelah status `"paid"`/`"sukses"` terdeteksi dan
   `showPaidOrderSuccess()`/`openTrackModalWithResult()` dipanggil, sehingga
   `setTimeout(poll, 3000)` **tidak lagi dijadwalkan ulang**. Satu transaksi
   yang sukses hanya memicu popup sukses/rating **tepat satu kali**.

### 3b. Token kadaluarsa memblokir checkout & rating (§2b)
`nexshop-backend/middleware/optionalAuthMiddleware.js` — token
invalid/kadaluarsa/format-salah sekarang di-fallback ke `req.user = null`
(mode guest) alih-alih `res.status(401)`. Sudah diverifikasi semua endpoint
yang memakai middleware ini (checkout order, checkout topup, rating
eligibility, submit rating, AI chat) sudah null-safe terhadap `req.user`
sebelum perubahan ini dilakukan.

### 3c. ID collision pada form rating (§2c)
`nexshop-frontend/script.js`, fungsi `renderRatingPrompt()` — semua
`document.getElementById(`rp_xxx_${uid}`)` diganti `container.querySelector(...)`.

### 3d. Badge rating di "Riwayat Saya" (§2d)
- `nexshop-backend/controllers/orderController.js`, `getMyOrders()` — tambah
  flag `has_rating` per order (query batch tunggal ke `order_ratings`).
- `nexshop-frontend/script.js`, `loadMyTransactions()` — render badge
  "Beri Rating" / "Sudah Dinilai" pada order `paid`.
- `nexshop-frontend/style.css` — class baru `.track-mine-rating-badge`
  (+ modifier `.needed` / `.done`).

### 3e. Karakter mojibake (§2f)
`nexshop-frontend/index.html` — 15 kemunculan `â€¢`/`â€”`/`â€“` diganti
karakter aslinya (•, —, –) lewat replace terprogram (bukan manual per baris,
supaya tidak ada yang kelewat/salah ganti). Tidak ada perubahan struktur
HTML, cuma isi teks.

### Tidak diubah
Tidak ada perubahan pada logic inti `renderRatingPrompt()` (alur
fetch-eligibility → render form → submit), endpoint eligibility, submit
rating, maupun mekanisme polling di "Cek Transaksi" (`renderTrackResult`,
`trackPollingTimer`) — semuanya sudah benar sebelumnya (polling di sana
sudah dijaga oleh pengecekan `trackOverlay.classList.contains("active")`
dan `closeOverlay("trackOverlay")` sudah menghentikan `trackPollingTimer`).

## 4. Regression Test

### A. Simulasi logic (otomatis, Node.js — dijalankan & lolos saat audit ini)
- **Skenario 1 — Tidak ada loop setelah paid** (`regtest/sim.js`): poll()
  dijalankan dengan mock fetch yang selalu mengembalikan status `"paid"`.
  Hasil: popup sukses/rating hanya terpicu **1 kali**, tidak ada polling
  lanjutan. ✅ **PASS**
- **Skenario 2 — Close (X/backdrop/Escape) benar-benar menghentikan polling**
  (`regtest/sim2.js`): modal ditutup saat status masih `"pending"`, lalu
  server baru mengonfirmasi `"paid"` setelahnya. Hasil: popup sukses/rating
  **tidak pernah** terpicu lagi setelah modal ditutup. ✅ **PASS**
- **Skenario 3 — ID collision form rating** (`regtest/sim3_domcollision.js`
  + `sim3b_prove_old_bug.js`, jsdom): order yang sama dirender ke dua
  container berbeda secara bersamaan. Dengan kode **lama**
  (`document.getElementById`), dibuktikan kedua container saling bentrok
  (form A === form B). Dengan kode **baru** (`container.querySelector`),
  dibuktikan masing-masing container mengontrol elemen miliknya sendiri.
  ✅ **PASS** (bug lama dikonfirmasi nyata, fix dikonfirmasi menutupnya)
- **Skenario 4 — Pemilihan badge rating** (`regtest/sim4_ratingbadge.js`):
  6 kombinasi status/type/has_rating diuji (order paid belum/sudah rating,
  order pending/failed, topup sukses/pending). ✅ **PASS** semua, termasuk
  memastikan topup tidak pernah dapat badge rating.
- **Skenario 5 — Logic `has_rating` di backend** (`regtest/sim5_has_rating.js`):
  memverifikasi flag `has_rating` benar untuk order paid-rated, paid-unrated,
  pending, dan failed. ✅ **PASS**
- **Skenario 6 — Perbaikan mojibake**: sebelum/sesudah dihitung otomatis
  (Python), memastikan 15 kemunculan `â€¢`/`â€”`/`â€“` di `index.html` jadi 0
  setelah perbaikan, file tetap valid UTF-8, jumlah baris (1092) dan
  line-ending (CRLF) tidak berubah. ✅ **PASS**

### B. Yang TIDAK bisa saya verifikasi di sesi audit ini
Saya tidak punya akses ke database Supabase, kredensial iPaymu, maupun
browser sungguhan yang terhubung ke backend live — jadi verifikasi di atas
bersifat **audit kode + simulasi logic terisolasi (Node.js/jsdom)**, bukan
klik-langsung end-to-end di browser dengan pembayaran & webhook asli. Semua
file juga sudah lolos `node -c` (syntax check) di seluruh
frontend/backend/middleware yang tersentuh maupun tidak tersentuh.
**Rekomendasi**: jalankan checklist manual di bawah (§C) di environment
staging sebelum deploy ke production, terutama skenario #1–#6b dan #13–#14.

### C. Checklist manual (untuk QA sebelum deploy)
| # | Skenario | Expected | Status |
|---|----------|----------|--------|
| 1 | Checkout produk (flow QRIS/VA) → bayar → webhook konfirmasi `paid` | Popup sukses + form rating muncul **satu kali**, otomatis | Sesuai fix §3a |
| 2 | Checkout (flow redirect/popup iPaymu) → bayar di tab popup → tab tertutup otomatis | Popup sukses + rating muncul, popup iPaymu ikut tertutup | Sesuai fix §3a |
| 3 | Buka modal QRIS/VA → klik **X** sebelum bayar → tunggu >10 detik | Tidak ada popup apa pun yang muncul otomatis setelahnya | Sesuai fix §3a |
| 4 | Buka modal QRIS/VA → tutup lewat **klik area luar modal (backdrop)** sebelum bayar → tunggu >10 detik | Tidak ada popup yang muncul otomatis | Sesuai fix §3a |
| 5 | Buka modal QRIS/VA → tutup lewat tombol **Escape** sebelum bayar → tunggu >10 detik | Tidak ada popup yang muncul otomatis | Sesuai fix §3a |
| 6 | Setelah popup sukses+rating muncul, isi & kirim rating (1–5 bintang + komentar) | Rating tersimpan, tampil "Terima kasih atas penilaian Anda!" | Tidak berubah (logic inti utuh) |
| 6b | Login sebagai user, tunggu/paksa token JWT kadaluarsa (>7 hari, atau ganti `JWT_SECRET` sementara di server untuk simulasi), lalu checkout & cek rating | Checkout & rating tetap berfungsi sebagai guest, bukan error "Token tidak valid" | Sesuai fix §3b |
| 7 | Refresh halaman ketika popup sukses/rating sedang terbuka | Popup tidak reopen sendiri berulang kali; state polling browser reset bersih (variabel JS di-reset saat reload) | Sesuai — tidak ada state persist ke localStorage yang memicu re-trigger |
| 8 | Redirect balik dari halaman pembayaran iPaymu (`#/payment-status?order=...&status=success`) lalu **refresh** halaman | Hash sudah dibersihkan (`history.replaceState`) setelah diproses pertama kali, sehingga refresh **tidak** memicu popup lagi | Tidak berubah — sudah benar sebelumnya |
| 9 | Fitur "Cek Transaksi" (Check by Order ID) — cek order dengan status `pending`, tunggu polling 5 detik jalan, lalu tutup modal | Polling `trackPollingTimer` berhenti begitu modal ditutup | Tidak berubah — sudah benar sebelumnya |
| 10 | Fitur "Riwayat Saya" — buka, lihat daftar order & topup | Daftar tampil, order `paid` menampilkan badge "Beri Rating"/"Sudah Dinilai"; topup tidak dapat badge | Sesuai fix §3d |
| 11 | Dua transaksi berturut-turut dalam satu sesi (checkout lagi setelah transaksi pertama selesai) | Polling transaksi lama otomatis dihentikan sebelum polling baru dimulai (tidak ada dua polling nyampur) | Tidak berubah — sudah dijaga oleh reset `ipaymuPollingTimeout`/`Controller` di awal tiap fungsi, sekarang ditambah reset `ipaymuActivePopupWindow` |
| 12 | Rating untuk order yang **sudah pernah dirating** dibuka lagi lewat "Cek Transaksi" | Menampilkan pesan "Rating sudah diberikan..." bukan form baru | Tidak berubah (source of truth = backend eligibility) |
| 13 | Dari "Riwayat Saya", klik order `paid` berbadge "Beri Rating" | Berpindah ke tab Cek Transaksi, detail order tampil, form rating langsung muncul | Sesuai fix §3d, ditopang §2c |
| 14 | Beri rating dari alur riwayat (poin 13), lalu buka "Riwayat Saya" lagi | Badge order tsb berubah jadi "Sudah Dinilai" | Sesuai fix §3d |
| 15 | Buka modal FAQ/S&K → tab "Syarat & Ketentuan" dan "Kebijakan Refund" | Tidak ada karakter aneh (â€” dkk); dash & bullet tampil normal | Sesuai fix §3e |
| 16 | Buka form Login, lihat placeholder field password | Muncul titik bullet (••••••••), bukan karakter aneh | Sesuai fix §3e |

## 5. File yang Diubah
- `nexshop-frontend/script.js`
  - Tambah: `stopIpaymuPolling()`, variabel global `ipaymuActivePopupWindow`
  - Ubah: `closeOverlay()`, `showDirectPaymentModal()`, `openIpaymuPopup()`,
    `renderRatingPrompt()` (scoping lookup ke `container`, §2c/§3c),
    `loadMyTransactions()` (badge rating, §2d/§3d)
  - Tidak diubah: logic inti `renderRatingPrompt()` (alur eligibility →
    render → submit), `showPaidOrderSuccess()`, `renderTrackResult()`
- `nexshop-frontend/style.css`
  - Tambah: `.track-mine-rating-badge` (+ `.needed` / `.done`)
- `nexshop-backend/middleware/optionalAuthMiddleware.js`
  - Ubah: fallback ke guest (`req.user = null`) untuk token invalid/
    kadaluarsa/format salah, alih-alih menolak request dengan 401
- `nexshop-backend/controllers/orderController.js`
  - Ubah: `getMyOrders()` menambahkan flag `has_rating` per order
- `nexshop-frontend/index.html`
  - Ubah: perbaikan 15 karakter mojibake (â€¢/â€”/â€“ → •/—/–), tidak ada
    perubahan struktur/konten lain
- Tidak diubah: `ratingController.js`, `ratingRoutes.js`, `topupController.js`,
  `authMiddleware.js` (middleware ketat untuk endpoint yang memang wajib
  login tidak disentuh), dan seluruh admin dashboard (`admin/js/dashboard.js`)
  — sudah diperiksa, tidak ditemukan bug serupa di sana (loading rating admin
  sudah dijaga flag `ratingsLoaded`, tidak ada polling yang bisa loop).

Semua perubahan disertai komentar `ROOT CAUSE FIX` / `BUG FIX` / `FEATURE`
langsung di kode agar mudah ditelusuri di masa depan.

---

# Sesi Lanjutan — Topup Rating, Testimoni "Apa Kata Mereka", & SSR/Sitemap

## Konteks penting
Sesi ini bekerja di atas **snapshot repo yang berbeda** dari sesi sebelumnya
di atas — ini adalah repo git asli yang terhubung ke GitHub (`ArielOsaze/
NEXSHOP_ALL`) dan sudah berkembang independen (redesign UI glassmorphism,
perbaikan flash-sale, dll — commit yang tidak pernah terlihat di sesi
sebelumnya). Sebelum menulis kode apa pun, dilakukan audit ulang dan
dikonfirmasi: **fix loop popup, fix middleware JWT, fix ID-collision rating,
fix mojibake, dan badge rating "Riwayat Saya" untuk order SUDAH diterapkan**
di repo ini (identik dengan yang didokumentasikan di bagian atas laporan
ini). **SSR meta-tag per-artikel dan sitemap dinamis JUGA sudah dibangun**
secara independen (`ssrController.js`, `sitemapController.js`, nginx sudah
di-proxy dengan benar) — tapi ditemukan beberapa bug nyata di situ yang
diperbaiki di sesi ini (lihat §7).

Yang BELUM ada dan dikerjakan di sesi ini: **rating untuk topup**, section
**testimoni "Apa Kata Mereka"**, dan **perbaikan bug SSR/sitemap**.

## 5. Fitur: Rating untuk Topup

Sebelumnya topup memang **tidak punya rating sama sekali** — dikonfirmasi
by design (bukan bug): `order_ratings` ber-FK ke tabel `orders` saja,
`ratingController.js` cuma query ke situ, frontend eksplisit
`if (orderData.type === "topup") return;`. User minta ini ditambahkan
(seperti Shopee — bisa rating produk maupun topup).

**Implementasi** (paritas penuh dengan rating produk):
- **Migration baru**: `nexshop-backend/migrations/002_create_topup_ratings.sql`
  — tabel `topup_ratings` terpisah (bukan reuse `order_ratings`, supaya
  tidak perlu ubah constraint FK tabel lama yang berisiko ke data existing).
  Kolom tambahan `display_name` (opsional) karena checkout topup **tidak
  pernah** mengumpulkan nama pembeli sama sekali — beda dari order yang
  sudah punya `recipient_name`.
  **⚠️ HARUS dijalankan manual di Supabase SQL Editor** — saya tidak
  punya akses/kredensial ke database, jadi tidak bisa menjalankannya
  sendiri. Endpoint topup-rating akan mengembalikan pesan error yang jelas
  ("belum di-setup") sampai migration ini dijalankan, bukan 500 mentah.
- **Backend** (`ratingController.js`): `checkTopupEligibility`,
  `submitTopupRating` — logic identik dengan versi order (cek status
  `"sukses"`, ownership kalau order match user login, cegah rating ganda),
  cuma target tabelnya `topup_orders`/`topup_ratings`.
- **Routes** (`ratingRoutes.js`): `GET /api/ratings/topup/eligibility/:orderId`,
  `POST /api/ratings/topup`.
- **Backend** (`topupController.js`, `getMyOrders`): tambah flag
  `has_rating` (query batch, sama pola dengan `orderController.getMyOrders`
  yang sudah ada sebelumnya untuk order).
- **Frontend** (`renderRatingPrompt` di `script.js`): sekarang bercabang
  `isTopup` — pilih endpoint eligibility/submit yang benar, dan untuk topup
  menampilkan field "Nama kamu (opsional)" tambahan di form (karena tidak
  ada nama asli yang bisa dipakai).
- **Frontend** (`renderTrackResult`): gate slot rating yang sebelumnya
  `data.type === "order"` dilonggarkan jadi berlaku untuk **semua** type
  yang sudah lunas (`isPaid`) — jadi rating topup otomatis muncul di popup
  "Cek Transaksi" setelah pembayaran topup sukses, sama seperti order.
- **Frontend** (`loadMyTransactions`): badge "Beri Rating"/"Sudah Dinilai"
  di "Riwayat Saya" tidak lagi di-gate ke `type === "order"` — berlaku untuk
  topup juga.

## 6. Fitur: Testimoni "Apa Kata Mereka"

Section baru di homepage, tepat di bawah Gaming News, menampilkan rating
tinggi (skor ≥4) yang punya komentar — **BUKAN** carousel klik-geser seperti
`#promoCarouselInner` yang sudah ada, tapi **marquee dua baris arah
berlawanan yang scroll otomatis tanpa henti**, pola yang dipakai website
besar (Stripe/Linear/Vercel dkk) untuk social proof.

- **Backend** (`ratingController.js`, `getPublicTestimonials`, endpoint
  publik `GET /api/ratings/public/testimonials`): gabungan `order_ratings`
  + `topup_ratings`, cuma skor≥4 dan ada komentar teks. Nama pembeli
  **disamarkan** ("Budi Santoso" → "Budi S.") — tidak pernah expose nama
  lengkap/email/no. HP/Order ID ke publik.
  **⚠️ Catatan moderasi**: TIDAK ada tahap approval admin — begitu rating
  masuk dengan skor tinggi + komentar, langsung tampil publik. Kalau nanti
  butuh kurasi (misal ada komentar kurang pantas meski skornya tinggi),
  perlu ditambah kolom `is_featured` + toggle UI admin — sengaja tidak
  dibangun sekarang (di luar cakupan yang diminta), tapi ini limitasi nyata
  yang perlu diketahui sebelum production.
- **Frontend**: section baru `#testimonials` di `index.html`, kartu pakai
  class `.home-glass-card` yang **sudah ada** di codebase ini (design
  system glassmorphism yang sama dipakai kartu News/Produk) — supaya
  visualnya konsisten dengan redesign UI yang sudah berjalan, bukan bikin
  gaya kartu baru sendiri.
- **CSS** (`style.css`): `.testimonial-marquee`/`.testimonial-track` dengan
  `@keyframes` dua arah, `mask-image` fade di tepi, **pause saat di-hover**,
  dan **menghormati `prefers-reduced-motion`** (animasi dimatikan, diganti
  scroll horizontal manual supaya konten tetap terjangkau).
- **JS** (`script.js`): `loadTestimonials()`/`renderTestimonials()` —
  section tetap `hidden` kalau tidak ada testimoni sama sekali (beda dari
  `#news` yang selalu tampil dengan pesan kosong). Konten tiap baris
  diduplikasi 2x supaya animasi `translateX(-50%)` loop mulus tanpa
  "patahan".

## 7. Perbaikan Bug di SSR (`/berita/:slug`) & Sitemap

Infrastruktur SSR meta-tag dan sitemap dinamis **sudah dibangun** sebelum
sesi ini (kemungkinan lewat sesi Claude Code terpisah) — nginx sudah benar
di-proxy (`/berita/:slug` dan `/sitemap.xml` → backend Express, bukan file
statis lagi). Diaudit dan ditemukan 4 bug nyata, semua diperbaiki:

1. **Halaman 404 artikel jadi fragmen HTML polos** (`ssrController.js`):
   sebelumnya `res.send("<h1>404 - Not Found</h1>...")` — tanpa
   `<html>/<head>/<body>`, tanpa CSS, tanpa navigasi situs sama sekali.
   Kalau ada yang share link artikel yang salah/terhapus, dapat halaman
   rusak. **Fix**: tetap kirim template `berita-artikel.html` yang sama
   (JS di halaman itu sendiri tetap menampilkan state "tidak ditemukan"
   miliknya sendiri, tidak ada perubahan perilaku untuk user asli), cuma
   title/description-nya diganti generik + status HTTP 404 tetap benar.
2. **Error database asli diperlakukan sama dengan "artikel tidak ada"**:
   sebelumnya `error || !article` → selalu 404, padahal error koneksi DB
   bukan berarti artikelnya tidak ada. **Fix**: dibedakan — error server
   asli → 200 + kirim template apa adanya (fallback aman, JS halaman tetap
   bisa fetch sendiri), genuinely not-found (query sukses, kosong) → 404 +
   meta generik.
3. **`sitemapController.js` hardcode `baseUrl = "https://nexshop.cloud"`**,
   tidak konsisten dengan `ssrController.js` yang benar pakai
   `process.env.FRONTEND_URL`. Kalau domain situs berbeda antara staging &
   production, sitemap akan terus menunjuk domain yang salah. **Fix**:
   disamakan, pakai `FRONTEND_URL` juga.
4. **Slug artikel tidak di-escape XML** di `<loc>` sitemap. Slug memang
   sudah disanitasi (`[a-z0-9-]` saja) saat dibuat jadi risikonya rendah,
   tapi tetap ditambahkan `escapeXml()` sebagai defense-in-depth untuk baris
   data lama yang mungkin belum tersanitasi.
5. **File statis `nexshop-frontend/sitemap.xml`** (isinya cuma homepage,
   beku/tidak pernah update) **dihapus** — dikonfirmasi dulu tidak ada
   referensi apa pun ke file ini di seluruh repo, dan nginx (`location =
   /sitemap.xml { proxy_pass ...backend... }`, exact-match, prioritas
   tertinggi) **selalu** proxy ke endpoint dinamis di production, jadi file
   statis ini cuma bangkai yang membingungkan (bisa menyesatkan kalau ada
   yang testing frontend secara statis tanpa nginx).

`robots.txt` sudah benar menunjuk ke `/sitemap.xml` (yang di-proxy nginx ke
endpoint dinamis) — tidak perlu diubah.

## 8. Regression Test (Sesi Lanjutan)

Semua di `regtest/`, dijalankan & PASS di sesi ini:
- `sim4_ratingbadge.js` — diperbarui, 8 kasus (4 order + 4 topup, termasuk
  yang baru: topup sukses belum/sudah rating).
- `sim7_testimonial_rows.js` — 9 kasus split/pad/duplikasi baris marquee,
  termasuk edge case 1 testimoni saja (pastikan tidak infinite loop).
- `sim8_ssr_sitemap_fixes.js` — 10 kasus: escapeXml, halaman 404 tetap
  pakai template utuh (bukan fragmen polos), konsistensi baseUrl.
- Seluruh 9 script logic (`sim.js` s/d `sim8_*.js`) dijalankan ulang
  sebagai satu batch — semua PASS.
- `node -c` (syntax check) di seluruh file backend (controllers/, routes/,
  middleware/) dan `nexshop-frontend/script.js` — semua lolos.

**Yang TIDAK dijalankan**: `regtest/test_ssr.js` (integration test yang
konek ke Supabase asli & insert/delete baris dummy) — sengaja tidak
dijalankan dari sesi ini karena saya tidak punya akses ke database
production kamu, dan tidak semestinya menjalankan test yang menulis ke DB
production tanpa izin eksplisit meski ada cleanup di akhir test. Logic yang
diubah di `ssrController.js`/`sitemapController.js` sudah diverifikasi
kompatibel dengan asersi test tersebut lewat pembacaan kode manual (lihat
komentar di `sim8_ssr_sitemap_fixes.js`) — jalankan `node regtest/
test_ssr.js` sendiri di environment staging untuk verifikasi end-to-end
sebelum production.

## 9. File yang Diubah/Ditambah (Sesi Lanjutan)
- **Baru**: `nexshop-backend/migrations/002_create_topup_ratings.sql`
  (⚠️ jalankan manual di Supabase)
- `nexshop-backend/controllers/ratingController.js` — tambah
  `checkTopupEligibility`, `submitTopupRating`, `getPublicTestimonials`,
  `maskPublicName`
- `nexshop-backend/routes/ratingRoutes.js` — tambah 3 route baru
- `nexshop-backend/controllers/topupController.js` — `getMyOrders`
  tambah flag `has_rating`
- `nexshop-backend/controllers/ssrController.js` — fix 404 & error handling
  (§7.1–7.2), baca file jadi async
- `nexshop-backend/controllers/sitemapController.js` — fix baseUrl &
  XML escaping (§7.3–7.4)
- `nexshop-backend/.env.example` — dokumentasi `FRONTEND_DIST_PATH`
  (opsional, ada default otomatis)
- **Dihapus**: `nexshop-frontend/sitemap.xml` (§7.5)
- `nexshop-frontend/script.js` — `renderRatingPrompt`, `renderTrackResult`,
  `loadMyTransactions` (topup rating); `loadTestimonials`,
  `renderTestimonials`, `testimonialCardHtml`, `testimonialInitials`
  (testimoni), dipanggil dari init sequence
- `nexshop-frontend/index.html` — section baru `#testimonials`
- `nexshop-frontend/style.css` — CSS marquee testimoni
- `AGENTS.md` — dokumentasi `regtest/` dan kewajiban migration manual
- `regtest/sim4_ratingbadge.js` — diperbarui (topup)
- **Baru**: `regtest/sim7_testimonial_rows.js`,
  `regtest/sim8_ssr_sitemap_fixes.js`
- `regtest/README.md` — diperbarui, termasuk peringatan soal `test_ssr.js`

## 10. Checklist Sebelum Production
1. **Jalankan `nexshop-backend/migrations/002_create_topup_ratings.sql`**
   di Supabase SQL Editor — tanpa ini, endpoint rating topup akan gagal.
2. Jalankan `node regtest/test_ssr.js` di staging (bukan production) untuk
   verifikasi end-to-end SSR/sitemap dengan data asli.
3. Uji share link artikel (`/berita/:slug`) ke WhatsApp/Telegram/Facebook —
   preview harus menampilkan judul & gambar artikel yang sebenarnya, bukan
   generic homepage.
4. Cek `https://nexshop.cloud/sitemap.xml` langsung di browser — harus
   XML dinamis berisi semua artikel, bukan cuma homepage.
5. Uji alur rating topup end-to-end: checkout topup → sukses → form rating
   muncul di popup "Cek Transaksi" → submit → cek muncul di "Apa Kata
   Mereka" (kalau skor≥4 & ada komentar) dan badge "Sudah Dinilai" di
   "Riwayat Saya".
6. Deploy ulang backend (route baru butuh restart proses Node/PM2) dan
   pastikan `nginx-nexshop.conf` yang aktif di server memang sudah versi
   yang proxy `/berita/:slug` & `/sitemap.xml` ke backend (tidak perlu
   diubah lagi di sesi ini — sudah benar — tapi konfirmasi versi yang
   ter-deploy memang yang ini).
