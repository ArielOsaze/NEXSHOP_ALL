# AGENTS

## Purpose
This repository is a small fullstack project with:
- `nexshop-backend/`: Express backend using Supabase and JWT auth.
- `nexshop-frontend/`: static HTML/JS frontend demo for the store and admin pages.
- `nginx-nexshop.conf`: reverse-proxy config that the backend expects when deployed.

## How to run
- Change to `nexshop-backend/`.
- Install dependencies with `npm install`.
- Start the backend with `npm start`.
- There are no automated tests in this repo, but `regtest/` at the project
  root has standalone logic-verification scripts (`node regtest/simN_*.js`)
  covering payment-popup polling, rating eligibility badges, SSR/sitemap
  fixes, etc. Most need no dependencies or DB access. The exception is
  `regtest/test_ssr.js`, which is a real integration test that connects to
  the live Supabase DB and inserts/deletes a throwaway article row — only
  run it against a non-production database.

## Database migrations
- `nexshop-backend/migrations/*.sql` are NOT run automatically — there is no
  migration runner in this project. Apply each file manually in the
  Supabase SQL Editor before the feature that depends on it will work.
- `002_create_topup_ratings.sql` must be run before the topup-rating
  endpoints (`/api/ratings/topup/*`) will work; until then they fail with a
  friendly "belum di-setup" message rather than a raw 500, but they don't
  work.
- `008_create_reseller.sql` must be run before the reseller program
  (`/api/reseller/*`, the `/reseller` page, and the Reseller panel in the
  admin dashboard) will work. Same pattern as the ratings migration: until
  it is applied, those endpoints answer 503 with
  `code: "RESELLER_NOT_SETUP"` and the UI shows a setup notice instead of
  crashing. Reseller pricing is derived at request time from
  `reseller_tiers.discount_percent` (see `utils/resellerPricing.js`); it is
  never stored per product, and it is floored so a reseller price can never
  drop below cost + 1% margin.

- `009_create_webhook_relay.sql` must be run before the Webhook Relay
  (`/api/webhooks/*` and the Settings > Webhook Relay tab in the admin
  dashboard) will work. Same pattern again: until it is applied those
  endpoints answer 503 with `code: "WEBHOOK_RELAY_NOT_SETUP"` and the panel
  shows a setup notice. The relay exists because TokoVoucher only allows one
  callback URL per member account: the callback lands once on
  `/api/topup/tokovoucher-webhook`, is reconciled for NexShop's own order,
  and is then fanned out to the other stores' URLs registered in
  `webhook_endpoints` (queued in `webhook_deliveries`, retried by
  `jobs/webhookRelayPoller.js`). Forwarding never blocks the 200 returned to
  TokoVoucher.

## WAJIB DI-SETUP SEBELUM DEPLOY (perubahan terbaru)

### 1. `KYC_ENCRYPTION_KEY` (environment variable) — WAJIB
Foto KTP pendaftar reseller sekarang dienkripsi AES-256-GCM sebelum disimpan
(`utils/secureDocument.js`). Tanpa env ini, endpoint upload `type=kyc|ktp`
sengaja menjawab **503 `KYC_KEY_MISSING`** dan menolak menyimpan berkas —
itu perilaku yang diinginkan: lebih baik pendaftaran tertahan daripada
dokumen identitas tersimpan tanpa enkripsi.

Isi dengan passphrase acak minimal 16 karakter, contoh:
`openssl rand -base64 48`.

**Kunci ini tidak boleh diganti setelah ada dokumen tersimpan.** Kunci
dekripsi diturunkan darinya, jadi mengganti nilai env membuat seluruh KTP
lama gagal didekripsi (`DECRYPT_FAILED`).

### 2. Bucket privat `kyc-documents` di Supabase Storage — WAJIB
Buat bucket bernama `kyc-documents` dan pastikan **Public = OFF**.
(Nama bisa diubah lewat env `SUPABASE_KYC_BUCKET`.)

Sebelumnya foto KTP diunggah ke bucket `avatars` yang **publik**, dan URL
publiknya disimpan di `reseller_applications.ktp_url` — artinya siapa pun
yang memegang URL itu bisa membuka KTP orang lain tanpa login, selamanya.
Sekarang berkasnya terenkripsi, di bucket privat, dan hanya bisa dilihat
lewat `GET /api/reseller/admin/kyc-document?ref=kyc:<path>` (admin/staff,
didekripsi on-the-fly, `Cache-Control: no-store`, setiap akses dicatat ke
log sebagai jejak audit).

Baris lama yang `ktp_url`-nya masih berupa URL `http(s)://` tetap bisa
ditinjau — panel admin mendeteksi bentuknya dan jatuh ke mode lama.

### 3. PERUBAHAN BREAKING: Secret Key Open API kini WAJIB
`middleware/apiKeyAuthMiddleware.js` dulu hanya memeriksa
`X-NexShop-Secret` *kalau kebetulan dikirim*, sehingga API Key saja sudah
cukup untuk memesan atas nama reseller — Secret Key praktis tidak berfungsi
sebagai faktor kedua. Sekarang header itu wajib; permintaan tanpanya dijawab
`401 SECRET_KEY_REQUIRED`.

**Mitra dengan integrasi berjalan harus diberi tahu sebelum deploy.**

Perbaikan lain di middleware yang sama:
- IP client tidak lagi dibaca dari header `X-Forwarded-For` / `X-Real-IP` /
  `CF-Connecting-IP` (bisa dipalsukan bebas oleh pemanggil); dipakai `req.ip`
  yang dihitung dari `trust proxy`.
- Bypass `clientIp === "127.0.0.1"` pada pengecekan IP whitelist DIHAPUS.
  Dikombinasikan dengan poin di atas, dulu cukup mengirim
  `X-Forwarded-For: 127.0.0.1` untuk melewati whitelist sepenuhnya.
- Perbandingan Secret Key jadi timing-safe.
- Fallback `JWT_SECRET` hardcoded dihapus dari
  `apiKeyAuthMiddleware.js` dan `optionalAuthMiddleware.js`.

## Etalase publik: indeks katalog & pemuatan bertahap

`services/catalogIndexService.js` membangun **indeks ringkas** katalog
(kartu per game/operator: nama, logo, jumlah produk, harga termurah, plus
teks pencarian) sekali lalu meng-cache-nya di memori selama 3 menit.

Endpoint yang dilayani dari indeks ini:
- `GET /api/topup/catalog/games?page&limit&q` — kartu game (halaman utama)
- `GET /api/topup/catalog/operators?page&limit&q&kategori` — kartu operator (Marketplace)
- `GET /api/topup/catalog/group/:jenis/:id/products` — isi satu grup

Endpoint lama (`/topup/products`, `/topup/public-catalog`) **tetap ada** dan
tidak diubah kontraknya, supaya integrasi/halaman yang belum dimigrasi tidak
rusak.

Dua hal yang tidak boleh diubah tanpa mengerti akibatnya:

1. **Pencarian harus tetap di server.** Kartu dikirim per halaman, jadi
   menyaring di browser hanya akan menelusuri kartu yang kebetulan sudah
   terunduh — produk yang belum termuat mustahil ditemukan. Filter `q`
   dijalankan atas indeks LENGKAP, termasuk nama tiap produk di dalam grup.
   `regtest/sim14_catalog_lazy_search.js` menjaga sifat ini.

2. **Jangan menulis harga reseller ke objek di dalam cache.** Cache dipakai
   bersama semua pengunjung. `getCatalogGroupProducts` menyalin produk dulu
   (`grup.products.map(p => ({ ...p }))`) sebelum menerapkan harga reseller;
   tanpa salinan itu, harga milik satu reseller bocor ke pengunjung
   berikutnya.

Cache dibatalkan otomatis oleh pembungkus di ujung
`controllers/topupController.js` (daftar `HANDLER_PENGUBAH_KATALOG`) dan oleh
`jobs/catalogSyncPoller.js`. Kalau menambah handler baru yang mengubah
produk, tambahkan namanya ke daftar itu — kalau tidak, etalase publik akan
menyajikan data lama sampai TTL habis. Handler yang namanya tidak ditemukan
akan memunculkan peringatan saat start-up.

## Uang & saldo: hal yang gampang rusak

- `services/walletService.js` memakai RPC atomik (`credit_wallet_atomic` /
  `debit_wallet_atomic`, migration 011) bila tersedia. Jalur cadangannya kini
  memakai **compare-and-swap** (`.eq("balance", balanceBefore)` + memeriksa
  jumlah baris terdampak lewat `.select()`), bukan baca-lalu-tulis polos.
  Pola lama kehilangan mutasi saat ada dua permintaan bersamaan, dan pada
  debit bahkan bisa menimpa `users.balance` dengan angka basi — uang tercipta
  kembali. Jangan kembalikan ke pola lama.

- Referensi debit order reseller **harus deterministik**
  (`RSL-PUR-{userId}-{refId}`). Versi lama menyertakan `Date.now()` sehingga
  tiap percobaan menghasilkan `reference_id` baru dan UNIQUE constraint di
  `wallet_transactions.reference_id` tidak pernah bisa menahan permintaan
  kembar.

- Pada tabrakan `23505` di `topup_orders` (UNIQUE
  `reseller_user_id, reseller_ref_id`), **jangan refund**. Saldo hanya
  terpotong sekali; versi lama refund di jalur ini sehingga setiap permintaan
  kembar menciptakan uang. Yang benar: kembalikan pesanan yang sudah ada.

## Anti-SSRF untuk URL yang ditentukan pengguna

`utils/safeOutboundUrl.js` memvalidasi setiap URL yang ditentukan pengguna
sebelum server kita meminta ke sana (Webhook URL reseller). Aturannya: HTTPS
wajib, tanpa userinfo, port 80/443 saja, dan seluruh hasil resolusi DNS harus
IP publik.

Dipakai di dua tempat dan keduanya perlu: saat **menyimpan** pengaturan, dan
sekali lagi tepat sebelum **mengirim** request (domain bisa diarahkan ulang ke
IP internal setelah lolos penyimpanan — DNS rebinding). `testPortalWebhook`
juga tidak mengikuti redirect dan tidak lagi memantulkan body respons dari
host tujuan.

## Removed features
- The legacy **Gaming News** aggregator (table `gaming_news`,
  `controllers/newsController.js`, routes `GET/POST /api/news`,
  `/api/news/all`, `/api/news/preview`, `PATCH|PUT|DELETE /api/news/:id`,
  and the "Gaming News" view in the admin dashboard) has been deleted. It
  was fully superseded by **NexShop News** (editorial), which lives in
  `controllers/newsArticleController.js` over the `news_articles` /
  `news_sources` tables and serves `/api/news/articles*` and
  `/api/news/admin/articles*`. The homepage news section and
  `berita.html` / `berita-artikel.html` already read the editorial
  endpoints, so nothing public changed except the heading wording.
  The `gaming_news` table is no longer referenced by any code and can be
  dropped in Supabase whenever convenient. Do not reintroduce a second
  news system.

## NexBot knowledge
- NexBot answers from three places, in this order (see
  `controllers/aiController.js` -> `answer()`): contact lookup, budget
  calculator, order lookup, **live price catalog**, then the RAG knowledge
  base.
- **Never put prices in knowledge text.** `BUILTIN_KNOWLEDGE` and the
  `knowledge_base` table are static, but prices change on every catalog
  sync / markup edit, and small models happily invent numbers. Any answer
  containing Rupiah must come from `topup_products` at request time via
  `utils/nexbotCatalog.js` (`handlePriceQuery`) or `handleBudgetQuery`.
  `regtest/sim10_nexbot_knowledge.js` fails the build if a knowledge chunk
  contains a Rupiah amount.
- `utils/nexbotCatalog.js` filters SKUs with `isCheckerUtilityProduct` from
  `utils/topupHelpers.js` — the SAME helper `getPublicCatalog` uses. Keep it
  that way: if NexBot and the storefront filter differently, the "mulai
  dari" price in chat stops matching the price on the page.
- After adding a knowledge chunk, add a retrieval case to
  `regtest/sim10_nexbot_knowledge.js`. A chunk that exists but never ranks
  is invisible — NexBot just answers "informasi belum tersedia".


## Important conventions
- Backend uses CommonJS modules and `type: commonjs` in `nexshop-backend/package.json`.
- Routes are organized under `nexshop-backend/routes/` and controllers under `nexshop-backend/controllers/`.
- `nexshop-backend/server.js` sets `app.set("trust proxy", 1)` because the app is designed to run behind Nginx.
- Missing or unparsed request bodies are normalized in `server.js` with `req.body = {}` so controllers can safely destructure.
- Protected endpoints use `nexshop-backend/middleware/authMiddleware.js` and require `Authorization: Bearer <token>`.
- The backend relies on environment variables, especially `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, and `JWT_SECRET` in production.

## Bug-audit focus areas
- `nexshop-backend/server.js`: request parsing, proxy/trust proxy behavior, rate limiter skip logic, error handler consistency.
- `nexshop-backend/controllers/`: validation of body fields, Supabase query error handling, and authentication flow.
- `nexshop-backend/config/db.js`: Supabase client setup on missing environment variables.
- `nexshop-backend/middleware/authMiddleware.js`: JWT verification and bearer token parsing.
- `nexshop-backend/middleware/rateLimiter.js`: rate-limit enforcement around auth and webhook endpoints.
- `nexshop-frontend/script.js`: demo-only frontend state management using `localStorage`, `API_BASE`, and current offline login/checkout assumptions.

## Notes for agents
- Preserve Indonesian comments and user-facing messages where possible.
- Do not assume the frontend is a full production integration; it contains simulated login and checkout behavior.
- If fixing bugs, confirm the backend routes and frontend API base remain consistent with the existing route paths.
- Prefer small, targeted changes when resolving issues, because there is no test suite.

## Useful files
- `nexshop-backend/server.js`
- `nexshop-backend/routes/authRoutes.js`
- `nexshop-backend/controllers/authController.js`
- `nexshop-backend/middleware/authMiddleware.js`
- `nexshop-backend/config/db.js`
- `nexshop-backend/middleware/rateLimiter.js`
- `nexshop-backend/services/webhookRelayService.js`
- `nexshop-frontend/script.js`
- `nginx-nexshop.conf`
