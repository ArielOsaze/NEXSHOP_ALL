"use strict";

const axios = require("axios");
const { getStoreSettings, getApiKeys, DEFAULT_GEMINI_MODEL, callGeminiWithFallback } = require("../config/settings");
const { normalizeQuery, detectIntent, detectEntities, rankKnowledge, buildKnowledgeResponse } = require("../utils/nexbotEngine");
const { isNexShopScope, formatProfessionalReply, OUT_OF_SCOPE_REPLY } = require("../utils/nexbotPolicy");
const nexbotCatalog = require("../utils/nexbotCatalog");
const { getResellerContext } = require("../services/resellerService");
const { hitungHargaReseller } = require("../utils/resellerPricing");
const aiProviderManager = require("../services/aiProviderManager");
const supabase = require("../config/db");

const NEXBOT_DB_TIMEOUT_MS = 3000;
const NEXBOT_AI_TIMEOUT_MS = 9000;
const NEXBOT_CHAT_TIMEOUT_MS = 14000;

function resolveWithin(task, timeoutMs, fallback) {
    let timer;
    const fallbackValue = () => typeof fallback === "function" ? fallback() : fallback;
    return Promise.race([
        Promise.resolve(task),
        new Promise((resolve) => {
            timer = setTimeout(() => resolve(fallbackValue()), timeoutMs);
        })
    ]).catch((error) => {
        console.warn("[NexBot] Operasi gagal, memakai fallback:", error?.message || error);
        return fallbackValue();
    }).finally(() => clearTimeout(timer));
}

function maskKey(value) {
    return aiProviderManager.maskKey(value);
}

// Shared AI calls route through aiProviderManager.

async function logGeminiRequest({ userMessage, modelUsed, responseTimeMs, tokenUsage, httpStatus, isSuccess, errorMessage, userId, sessionId }) {
    const payload = {
        user_message: safeMessage(userMessage),
        model_used: modelUsed || "gemini-2.5-flash",
        response_time_ms: Math.round(responseTimeMs || 0),
        token_usage: tokenUsage || null,
        http_status: Number(httpStatus || 200),
        is_success: !!isSuccess,
        error_message: errorMessage ? String(errorMessage).slice(0, 1000) : null,
        user_id: userId ? String(userId) : null,
        session_id: sessionId || null
    };
    try {
        await resolveWithin(supabase.from("ai_gemini_logs").insert(payload), NEXBOT_DB_TIMEOUT_MS, null);
    } catch (err) {
        console.warn("Gemini log insert warning:", err.message);
    }
}

// This is deliberately small. It makes the public assistant safe during a
// migration, but it is not a writable pseudo-database: admin changes must be
// persisted in Supabase or fail visibly.
const BUILTIN_KNOWLEDGE = [
    { id: "builtin-wallet", title: "NexShop Wallet", category: "Guide", keywords: "nexshop wallet dompet saldo nexshop isi saldo topup saldo bayar pakai saldo mutasi saldo", content: "NexShop Wallet adalah saldo internal NexShop (bukan e-wallet pihak ketiga seperti DANA/OVO/GoPay). Saldo bisa diisi lewat tombol NexShop Wallet di header website, dibayar via iPaymu (QRIS, VA, transfer bank, dsb), lalu langsung bertambah otomatis setelah pembayaran terkonfirmasi. Saldo NexShop Wallet dapat dipakai sebagai metode pembayaran saat checkout topup maupun produk Marketplace supaya belanja lebih cepat tanpa buka payment gateway berulang. Riwayat pemakaian dan pengisian saldo bisa dilihat di menu mutasi wallet, dan jika ada pesanan yang gagal setelah dibayar pakai saldo, dananya otomatis dikembalikan ke NexShop Wallet.", priority: 6, status: "active" },
    { id: "builtin-gamepass", title: "Apa itu Xbox Game Pass di NexShop", category: "Guide", keywords: "apa itu game pass xbox game pass gamepass gampass xgp private sharing pengertian", content: "Xbox Game Pass adalah layanan langganan resmi Microsoft yang memberi akses ke katalog ratusan game Xbox/PC selama masa aktif langganan. NexShop menjual aktivasi Xbox Game Pass dalam dua jenis: Sharing (lebih hemat, akun dipakai bersama sesuai kuota) dan Private (personal, satu akun untuk satu pembeli). Setelah pembayaran terkonfirmasi, tim NexShop memproses aktivasi ke akun Microsoft sesuai jenis paket yang dibeli. Detail perbedaan Sharing vs Private dan cara aktivasinya bisa dibaca lebih lengkap di kartu produk Game Pass masing-masing.", priority: 5, status: "active" },
    { id: "builtin-payment", title: "Metode Pembayaran", category: "Payment", keywords: "bayar pembayaran qris dana ovo gopay transfer bank va ipaymu", content: "Pembayaran NexShop diproses dengan aman menggunakan iPaymu sebagai payment gateway. Metode yang didukung meliputi QRIS, e-wallet (DANA, OVO, GoPay), Virtual Account, transfer bank, dan kartu kredit, ditambah saldo NexShop Wallet sebagai opsi pembayaran instan. Pilihan tersedia lengkap saat Checkout. Catatan: di sini DANA, OVO, dan GoPay berperan sebagai ALAT BAYAR. Terpisah dari itu, NexShop juga MENJUAL isi ulang saldo e-wallet tersebut sebagai produk di halaman Marketplace, jadi saldo DANA, OVO, GoPay, dan ShopeePay memang bisa dibeli di NexShop.", priority: 5, status: "active" },
    { id: "builtin-escrow", title: "Mekanisme Escrow", category: "Trust", keywords: "escrow aman penipuan tahan dana garansi uang kembali", content: "NexShop menyediakan mekanisme escrow untuk transaksi yang mendukungnya. Untuk transaksi yang menggunakan mekanisme escrow NexShop, dana ditahan sesuai alur escrow sampai kondisi transaksi terpenuhi.", priority: 5, status: "active" },
    { id: "builtin-legal", title: "Legalitas dan OSS", category: "Trust", keywords: "aman resmi legal penipu scam oss nib kbli terdaftar", content: "NexShop telah memiliki NIB dan terdaftar secara resmi melalui sistem OSS pemerintah. NIB NexShop adalah 1408260072494 dengan skala usaha mikro dan KBLI 60390. Untuk detail legalitas, buka bagian Informasi Legalitas di website NexShop.", priority: 5, status: "active" },
    // Jawaban langsung buat pertanyaan umum "apakah NexShop aman/terpercaya?".
    // Sebelumnya pertanyaan ini cuma nyantol ke chunk Escrow & Legalitas yang
    // terpisah (skor lemah, ~27 masing-masing) jadi sinyalnya kurang kuat dan
    // model sering ragu lalu jatuh ke kalimat fallback. Chunk ini menyatukan
    // poin-poin trust jadi satu fakta yang match kuat ke intent "Trust".
    { id: "builtin-trust", title: "Keamanan Bertransaksi di NexShop", category: "Trust", keywords: "aman terpercaya keamanan transaksi kepercayaan", content: "NexShop terdaftar resmi di sistem OSS pemerintah dengan NIB 1408260072494, menggunakan mekanisme escrow untuk transaksi yang mendukungnya, dan memproses pembayaran melalui iPaymu sebagai payment gateway resmi. Kombinasi ini yang jadi dasar keamanan bertransaksi di NexShop.", priority: 6, status: "active" },
    { id: "builtin-topup", title: "Cara Topup Diamond", category: "Guide", keywords: "cara topup diamond ml mlbb mobile legends free fire pubg", content: "Buka menu Topup, pilih game, masukkan User ID dan Zone ID bila diminta, pilih nominal, lalu selesaikan pembayaran. Pesanan diproses otomatis setelah pembayaran terkonfirmasi.", priority: 5, status: "active" },
    { id: "builtin-produk", title: "Cara Membeli Produk", category: "Guide", keywords: "cara membeli produk beli produk checkout keranjang cart pesan barang", content: "Buka menu Produk, pilih item yang kamu inginkan, klik Beli atau tambahkan ke keranjang. Lanjutkan ke Checkout, isi data penerima (nama, kontak, alamat/ID sesuai jenis produk), pilih metode pembayaran, lalu selesaikan pembayaran. Pesanan diproses otomatis setelah pembayaran terkonfirmasi dan status pesanan bisa dicek lewat menu Cek Transaksi.", priority: 5, status: "active" },
    { id: "builtin-refund", title: "Kebijakan Refund", category: "Policy", keywords: "refund pengembalian dana batal garansi", content: "Untuk kendala saldo atau item yang tidak masuk, siapkan Nomor Order ID dan hubungi Customer Service NexShop agar pesanan dapat diperiksa secara manual.", priority: 5, status: "active" },

    // ------------------------------------------------------------------
    // MARKETPLACE / PPOB
    //
    // Sebelumnya NexBot sama sekali gak kenal halaman Marketplace: ditanya
    // "bisa isi DANA gak?" atau "bayar PLN di sini bisa?" dia jatuh ke
    // kalimat fallback, padahal itu salah satu layanan utama NexShop.
    //
    // Fakta di sini sengaja TANPA ANGKA HARGA. Harga berubah tiap admin
    // sync katalog; kalau ditulis di sini NexBot bakal nyebut harga basi.
    // Pertanyaan harga ditangani terpisah dan selalu query harga hidup --
    // lihat handlePriceQuery() di bawah.
    // ------------------------------------------------------------------
    { id: "builtin-marketplace", title: "Marketplace NexShop (E-Wallet, Pulsa, Tagihan)", category: "Guide", keywords: "marketplace ppob e-wallet ewallet dompet digital dana ovo gopay shopeepay linkaja pulsa paket data kuota pln token listrik tagihan e-toll layanan digital one stop", content: "Selain topup game, NexShop punya halaman Marketplace di nexshop.cloud/marketplace untuk kebutuhan digital harian. Layanan yang tersedia di sana: isi ulang E-Wallet (antara lain DANA, OVO, GoPay, ShopeePay, LinkAja), pulsa semua operator, paket data dan voucher kuota, token listrik PLN, saldo E-Toll, voucher game, layanan hiburan/streaming, serta pembayaran tagihan (PDAM, BPJS, internet pascabayar, TV kabel, multifinance, asuransi). Ketersediaan produk mengikuti katalog yang sedang aktif.", priority: 6, status: "active" },
    { id: "builtin-marketplace-cara", title: "Cara Beli di Marketplace NexShop", category: "Guide", keywords: "cara beli marketplace cara isi ulang e-wallet ewallet dompet digital cara topup pulsa cara beli paket data cara bayar pln token listrik cara isi dana ovo gopay langkah checkout marketplace nomor tujuan", content: "Langkah membeli di halaman Marketplace: buka nexshop.cloud/marketplace, pilih kategori di panel Kategori atau ketik nama layanan di kolom pencarian, klik kartu penyedia layanan yang dituju, pilih nominal atau produk yang diinginkan, isi nomor tujuan (nomor HP, nomor pelanggan, atau ID akun sesuai jenis layanan), pilih metode pembayaran, lalu selesaikan pembayaran. Pesanan diproses otomatis setelah pembayaran terkonfirmasi, dan statusnya bisa dicek lewat menu Cek Transaksi.", priority: 6, status: "active" },
    { id: "builtin-pascabayar", title: "Cek Tagihan Pascabayar", category: "Guide", keywords: "pascabayar cek tagihan pdam bpjs telkom indihome multifinance tagihan listrik pascabayar inquiry", content: "Untuk produk pascabayar (misalnya PLN pascabayar, PDAM, BPJS, internet pascabayar, dan multifinance), NexShop menyediakan tombol Cek Tagihan di halaman checkout Marketplace. Masukkan nomor pelanggan lalu klik Cek Tagihan untuk melihat nama pelanggan dan jumlah tagihan sebelum melanjutkan pembayaran.", priority: 5, status: "active" },
    { id: "builtin-reseller", title: "Program Reseller NexShop", category: "Guide", keywords: "reseller jualan lagi harga khusus diskon reseller daftar reseller tier silver gold platinum mitra agen partner portal", content: "Program Reseller NexShop ditujukan untuk mitra yang menjual kembali produk digital melalui Partner Portal atau integrasi API. Akun Portal Reseller benar-benar terpisah dari akun belanja NexShop. Pengajuan, KYC, status review, harga tier, saldo mitra, transaksi, serta konfigurasi API dikelola dari nexshop.cloud/portal-reseller.", priority: 6, status: "active" },
    { id: "builtin-reseller-onboarding", title: "Pendaftaran dan KYC Portal Reseller NexShop", category: "Guide", keywords: "cara daftar reseller pendaftaran partner portal daftar baru kyc akun portal benar-benar terpisah akun belanja storefront email berbeda nama lengkap whatsapp nik foto ktp turnstile verifikasi keamanan", content: "Pendaftaran reseller dilakukan langsung di tab Daftar Baru & KYC pada Partner Portal NexShop. Akun belanja/storefront tidak dapat dipakai untuk login portal dan tidak otomatis menjadi akun reseller. Gunakan email khusus portal yang belum pernah dipakai untuk akun NexShop serta password portal tersendiri.\n\nData wajib:\n- Email Portal Reseller khusus dan password minimal 8 karakter.\n- Nama Lengkap sesuai KTP dan nomor WhatsApp aktif.\n- NIK 16 digit dan Foto KTP asli yang jelas.\n\nLengkapi profil usaha bila ada, selesaikan verifikasi keamanan, lalu kirim formulir satu kali. Satu pengiriman membuat identity portal terpisah, pengajuan reseller, dan berkas KYC.", priority: 8, status: "active" },
    { id: "builtin-reseller-approval", title: "Status Review dan Aktivasi Portal Reseller NexShop", category: "Guide", keywords: "portal reseller status pendaftaran status kyc review verifikasi admin pending menunggu verifikasi approved rejected suspended 3x24 jam cek status verifikasi terkini transaksi api", content: "Setelah formulir berhasil dikirim, akun Portal Reseller terbentuk dengan status pending atau Menunggu Verifikasi. Pengguna dapat masuk ke dashboard dan memilih Cek Status Verifikasi Terkini tanpa membuat akun ulang. Review admin berlangsung maksimal 3x24 jam kerja.\n\nBatas status:\n- Pending: boleh memantau status, membaca panduan, dan melihat katalog, tetapi belum dapat melakukan transaksi reseller atau memakai API.\n- Approved: transaksi reseller, harga tier, saldo mitra, serta integrasi API dapat digunakan.\n- Rejected: ikuti catatan peninjauan atau hubungi Customer Service sebelum memperbaiki data.\n- Suspended: akses dibekukan dan penyelesaiannya melalui admin NexShop.", priority: 8, status: "active" },
    { id: "builtin-reseller-security", title: "Keamanan dan 2FA Portal Reseller", category: "TechnicalSupport", keywords: "keamanan portal reseller 2fa opsional authenticator totp kode 6 digit recovery code sekali pakai pengaturan login", content: "Portal Reseller mendukung 2FA opsional melalui aplikasi authenticator. Aktifkan dari menu Pengaturan dan konfirmasi setup dengan kode 6 digit. Setelah aktif, setiap login memerlukan kode authenticator atau satu recovery code yang belum pernah dipakai. Recovery code bersifat sekali pakai, harus disimpan di tempat aman, dan tidak dapat diminta kembali dalam bentuk plaintext. Jangan pernah membagikan password portal, kode authenticator, recovery code, API Key, atau Secret Key.", priority: 8, status: "active" },
    { id: "builtin-reseller-api", title: "API Key dan Secret Key Reseller NexShop", category: "Guide", keywords: "api reseller api key secret key webhook ip whitelist integrasi backend server approved portal", content: "API Key dan Secret Key reseller tersedia setelah pengajuan disetujui admin. Kredensial dipakai hanya dari backend/server toko, bukan dari JavaScript browser, aplikasi publik, screenshot, atau repository. Simpan Secret Key sebagai environment variable. Atur IP Whitelist dan Webhook URL HTTPS dari menu API & Integrasi, lalu gunakan dokumentasi endpoint reseller sebagai kontrak implementasi.", priority: 8, status: "active" },
    { id: "builtin-berita", title: "Portal Berita NexShop News", category: "Guide", keywords: "berita artikel news portal berita nexshop news baca artikel", content: "NexShop punya portal berita sendiri bernama NexShop News di nexshop.cloud/berita, berisi artikel editorial seputar game dan dunia digital yang ditulis tim NexShop.", priority: 3, status: "active" },
    { id: "builtin-promo", title: "Promo NexShop Hari Ini", category: "Promotion", keywords: "promo hari ini diskon voucher kupon kode promo cashback penawaran terbaru", content: "Promo NexShop dapat berubah mengikuti periode dan ketersediaan produk. Promo yang sedang aktif ditampilkan pada banner dan kartu produk di website. Jika tidak ada label promo pada produk yang dipilih, gunakan harga terbaru yang tampil saat checkout. Reseller yang sudah disetujui mendapatkan harga sesuai tier secara otomatis saat login dan tidak perlu memasukkan kode promo.", priority: 5, status: "active" },
    { id: "builtin-faq", title: "FAQ dan Bantuan NexShop", category: "Guide", keywords: "faq pertanyaan umum bantuan pusat bantuan informasi nexshop tanya apa saja", content: "NexBot dapat membantu menjelaskan produk, cara topup dan checkout, metode pembayaran, NexShop Wallet, Marketplace, reseller, refund, serta cara mengecek status pesanan. Untuk pemeriksaan transaksi tertentu, kirim Nomor Order ID atau email yang digunakan saat checkout. Jika pertanyaannya membutuhkan pemeriksaan manual, hubungi Customer Service resmi NexShop.", priority: 4, status: "active" },
    { id: "builtin-process", title: "Waktu Proses Pesanan", category: "Order", keywords: "berapa lama proses pesanan masuk pending menunggu belum masuk kapan selesai durasi topup", content: "Pesanan mulai diproses setelah pembayaran terkonfirmasi. Lama proses dapat berbeda mengikuti jenis produk dan respons provider. Pantau status melalui menu Cek Transaksi menggunakan Nomor Order ID. Jika status tidak berubah atau produk belum masuk setelah proses provider selesai, siapkan Nomor Order ID lalu hubungi Customer Service NexShop.", priority: 5, status: "active" },
    { id: "builtin-account", title: "Akun dan Login NexShop", category: "TechnicalSupport", keywords: "akun daftar registrasi login masuk lupa password otp email verifikasi tidak bisa login storefront belanja", content: "Akun belanja NexShop digunakan untuk menyimpan identitas transaksi, melihat riwayat, dan memakai NexShop Wallet. Akun ini terpisah dari akun Portal Reseller dan tidak dapat dipakai untuk login ke Partner Portal. Jika login storefront gagal, periksa kembali email dan password, lalu gunakan alur pemulihan akun yang tersedia. Jangan pernah membagikan password atau OTP kepada siapa pun, termasuk pihak yang mengaku sebagai admin.", priority: 5, status: "active" },
    { id: "builtin-harga-cek", title: "Cara Mengetahui Harga Produk", category: "Pricing", keywords: "harga berapa biaya tarif daftar harga cek harga list harga", content: "Harga setiap produk NexShop bisa berubah sewaktu-waktu mengikuti harga penyedia. Harga terbaru selalu tampil di halaman produknya: menu Topup untuk topup game, dan halaman Marketplace untuk E-Wallet, pulsa, paket data, PLN, dan tagihan. Kamu juga bisa menanyakan harga suatu layanan langsung ke NexBot, dan angkanya diambil dari katalog yang sedang aktif.", priority: 4, status: "active" }
];

const QUICK_ACTIONS = {
    topup: "Cara Topup ML",
    promo: "Promo Hari Ini",
    order: "Status Pesanan Saya",
    faq: "FAQ NexShop"
};

// Pertanyaan yang ditampilkan sebagai tombol template wajib selalu bisa
// dijawab tanpa bergantung pada koneksi provider AI. Nilainya menunjuk ke
// BUILTIN_KNOWLEDGE supaya fakta tidak disalin ke dua tempat dan menjadi basi.
const TEMPLATE_KNOWLEDGE_BY_QUERY = Object.freeze({
    "apakah nexshop aman": "builtin-trust",
    "apakah nexshop legal": "builtin-legal",
    "pembayaran pakai apa": "builtin-payment",
    "ada escrow": "builtin-escrow",
    "cara membeli produk": "builtin-produk",
    "cara top up": "builtin-topup",
    "cara topup": "builtin-topup",
    "cara topup ml": "builtin-topup",
    "apa itu marketplace nexshop": "builtin-marketplace",
    "cara daftar reseller": "builtin-reseller-onboarding",
    "kebijakan refund": "builtin-refund",
    "promo hari ini": "builtin-promo",
    "faq nexshop": "builtin-faq"
});

function normalizeTemplateQuery(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function getTemplateKnowledge(message) {
    const id = TEMPLATE_KNOWLEDGE_BY_QUERY[normalizeTemplateQuery(message)];
    return id ? BUILTIN_KNOWLEDGE.find((item) => item.id === id) || null : null;
}

// ============================================================================
// FEATURE: Rekomendasi budget topup (mis. "aku punya uang 10.000 mau beli
// diamond bisa dapat berapa"). Ini SENGAJA dijawab pakai query harga asli
// dari topup_products, BUKAN dilempar ke Groq -- karena AI (apalagi model
// kecil) gampang salah hitung / ngarang nominal harga. Dengan begini
// jawabannya selalu akurat sesuai daftar harga yang beneran aktif di web.
// ============================================================================

// Peta nama entity (dari ENTITY_CATALOG nexbotEngine, yang alias-nya sudah
// dijaga pakai word-boundary regex -- "ml"/"ff" dsb gak nyasar match ke kata
// lain) ke potongan nama kategori di topup_products.
const BUDGET_ENTITY_TO_CATEGORY = {
    "Mobile Legends": "Mobile Legends",
    "Free Fire": "Free Fire",
    "PUBG Mobile": "PUBG"
};

function detectBudgetGameCategory(rawMessage) {
    const entities = detectEntities(normalizeQuery(rawMessage));
    for (const entity of entities) {
        if (BUDGET_ENTITY_TO_CATEGORY[entity]) return BUDGET_ENTITY_TO_CATEGORY[entity];
    }
    // Default: sebut "diamond" tanpa nama game spesifik -> asumsikan Mobile
    // Legends (istilah "diamond" paling umum dipakai buat ML di Indonesia).
    if (/\bdiamond\b|\bdiamon\b/.test(String(rawMessage || "").toLowerCase())) return "Mobile Legends";
    return null;
}

// Parse nominal uang gaya Indonesia: "10.000", "10000", "10rb", "10 ribu",
// "50k", "1jt", "1 juta".
function parseIndonesianAmount(rawMessage) {
    const t = String(rawMessage || "").toLowerCase();
    const suffixMatch = t.match(/(\d+(?:[.,]\d+)?)\s*(ribu|rb|k|juta|jt)\b/);
    if (suffixMatch) {
        const base = parseFloat(suffixMatch[1].replace(",", "."));
        const unit = suffixMatch[2];
        if (!Number.isFinite(base)) return null;
        return Math.round(unit === "juta" || unit === "jt" ? base * 1000000 : base * 1000);
    }
    const plainMatch = t.match(/\b(\d{1,3}(?:\.\d{3})+|\d{4,9})\b/);
    if (plainMatch) {
        const value = parseInt(plainMatch[1].replace(/\./g, ""), 10);
        return Number.isFinite(value) ? value : null;
    }
    return null;
}

function isBudgetQuestion(rawMessage) {
    const t = String(rawMessage || "").toLowerCase();
    const mentionsMoney = /\b(uang|budget|dana|duit|modal)\b/.test(t) || /\d+\s*(ribu|rb|k|juta|jt)\b/.test(t);
    const asksAfford = /(dapat berapa|dpt berapa|dapet berapa|bisa (dapat|dapet|dpt|beli)|cukup\s*(ga|gak|nggak|tidak)?|beli apa aja|dapat apa)/.test(t);
    return mentionsMoney && asksAfford;
}

async function handleBudgetQuery(message) {
    const budget = parseIndonesianAmount(message);
    const categoryLike = detectBudgetGameCategory(message);

    if (!budget) {
        return "Boleh sebutkan nominal budget kamu (mis. \"budget 20.000\" atau \"punya uang 50rb\") supaya aku bisa carikan paket diamond yang pas?";
    }
    // Kalau bukan salah satu dari tiga game di BUDGET_ENTITY_TO_CATEGORY,
    // coba cocokkan ke SELURUH katalog marketplace (E-Wallet, Pulsa, Paket
    // Data, PLN, dst). Dulu pertanyaan "punya 50rb bisa dapat pulsa apa"
    // selalu mentok di pertanyaan balik "mau topup game apa?" padahal
    // customer-nya gak nanya game sama sekali.
    let targetKolom = "kategori";
    let targetNilai = categoryLike;
    if (!categoryLike) {
        const match = await nexbotCatalog.matchCatalogTarget(message);
        if (!match) {
            return `Budget Rp${budget.toLocaleString("id-ID")} mau dipakai buat layanan apa ya? (mis. Mobile Legends, pulsa Telkomsel, saldo DANA, atau token PLN)`;
        }
        targetKolom = match.type === "operator" ? "source_operator_name" : "kategori";
        targetNilai = match.value;
    }

    const { data: withinBudget } = await supabase
        .from("topup_products")
        .select("nama, harga_jual, kategori, kode_produk")
        .eq("is_active", true)
        .ilike(targetKolom, `%${targetNilai}%`)
        .lte("harga_jual", budget)
        .order("harga_jual", { ascending: false })
        .limit(5);

    const clean = (withinBudget || []).filter((p) => !isForeignBudgetProduct(p.kode_produk));

    if (!clean.length) {
        const { data: cheapest } = await supabase
            .from("topup_products")
            .select("nama, harga_jual")
            .eq("is_active", true)
            .ilike(targetKolom, `%${targetNilai}%`)
            .order("harga_jual", { ascending: true })
            .limit(1);
        const min = cheapest?.[0];
        if (min) {
            return `Untuk ${targetNilai}, budget Rp${budget.toLocaleString("id-ID")} belum cukup nih. Produk termurah yang tersedia saat ini **${min.nama}** seharga **Rp${Number(min.harga_jual).toLocaleString("id-ID")}**.`;
        }
        return unavailableReply();
    }

    const best = clean[0];
    const others = clean.slice(1);

    const { data: nextTierRows } = await supabase
        .from("topup_products")
        .select("nama, harga_jual")
        .eq("is_active", true)
        .ilike(targetKolom, `%${targetNilai}%`)
        .gt("harga_jual", budget)
        .order("harga_jual", { ascending: true })
        .limit(1);
    const nextTier = nextTierRows?.[0];

    let reply = `Dengan budget Rp${budget.toLocaleString("id-ID")} untuk ${targetNilai}, produk yang paling pas kamu dapat: **${best.nama}** seharga **Rp${Number(best.harga_jual).toLocaleString("id-ID")}**.`;
    if (others.length) {
        reply += `\n\nOpsi lain yang juga muat di budget kamu:\n${others.map((p) => `• ${p.nama} — Rp${Number(p.harga_jual).toLocaleString("id-ID")}`).join("\n")}`;
    }
    if (nextTier) {
        const gap = Number(nextTier.harga_jual) - budget;
        reply += `\n\nKalau nambah sekitar Rp${gap.toLocaleString("id-ID")} lagi (jadi Rp${Number(nextTier.harga_jual).toLocaleString("id-ID")}), kamu bisa dapat **${nextTier.nama}** yang lebih besar.`;
    }
    return reply;
}

// ============================================================================
// FEATURE: Pertanyaan harga langsung ("harga topup DANA berapa?", "pulsa
// Telkomsel berapaan?", "token PLN mulai dari berapa?").
//
// Sama alasannya dengan handleBudgetQuery: angka TIDAK BOLEH datang dari
// model bahasa. Harga NexShop berubah tiap admin sync katalog atau ubah
// markup, dan model kecil gampang ngarang nominal. Jadi begitu customer
// nyebut kategori/operator yang beneran ada di katalog aktif, jawabannya
// dirakit dari baris topup_products yang sedang tayang -- sumber yang sama
// dengan halaman Marketplace.
//
// Balikin null artinya "bukan pertanyaan harga yang bisa aku pastikan";
// pertanyaannya lalu diteruskan ke alur knowledge biasa, bukan dipaksa
// dijawab di sini.
// ============================================================================
const MAX_PRICE_ROWS = 5;

async function handlePriceQuery(message, user) {
    if (!nexbotCatalog.isPriceQuestion(message)) return null;

    const target = await nexbotCatalog.matchCatalogTarget(message);
    if (!target) return null;

    const { rows, total, error } = await nexbotCatalog.fetchProductsForTarget(target, { limit: MAX_PRICE_ROWS });
    if (error || !rows.length) return null;

    // Reseller yang sudah login lihat harga resellernya sendiri, biar
    // angka di chat gak beda sama yang dia lihat di halaman Marketplace.
    let diskon = 0;
    try {
        const ctx = await getResellerContext(user?.id);
        if (ctx.isReseller) diskon = ctx.discountPercent;
    } catch (_) { /* status reseller opsional -- fallback ke harga publik */ }

    const hargaFinal = (row) => {
        if (!diskon) return Number(row.harga_jual);
        return hitungHargaReseller(Number(row.harga_jual), Number(row.harga_beli), diskon);
    };

    const label = target.type === "operator" ? target.value : `kategori ${target.value}`;
    const termurah = hargaFinal(rows[0]);

    const daftar = rows
        .map((row) => `- ${row.nama}: **${nexbotCatalog.rupiah(hargaFinal(row))}**`)
        .join("\n");

    let reply = `Harga ${label} di NexShop mulai dari **${nexbotCatalog.rupiah(termurah)}**.`;
    reply += `\n\n${daftar}`;

    if (total > rows.length) {
        reply += `\n\nMasih ada ${total - rows.length} pilihan lain. Daftar lengkapnya ada di halaman Marketplace NexShop.`;
    }
    if (diskon) {
        reply += `\n\nAngka di atas sudah harga reseller kamu.`;
    }
    reply += `\n\nHarga bisa berubah sewaktu-waktu mengikuti harga penyedia, jadi harga saat checkout yang berlaku.`;

    return reply;
}

// Filter kasar region luar Indonesia -- sama prinsipnya kayak isForeignProduct
// di topupController.js, dibuat versi ringan di sini biar aiController gak
// perlu require seluruh topupController hanya buat 1 fungsi ini.
function isForeignBudgetProduct(kodeProduk) {
    return /(PH|SG|MY|TH|VN|GLOBAL)$/i.test(String(kodeProduk || "").trim());
}

function safeSessionId(value) {
    const fallback = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return typeof value === "string" && /^[a-zA-Z0-9_-]{8,100}$/.test(value) ? value : fallback;
}

function safeMessage(value) {
    return typeof value === "string" ? value.trim().slice(0, 2000) : "";
}

function knowledgeColumns() {
    return "id,title,category,keywords,content,status,priority,updated_at,source_url,source_title";
}

async function loadKnowledge(query) {
    // RPC full-text search dipakai sebagai PENAMBAH recall, BUKAN sebagai
    // filter keras. Sebelumnya, begitu RPC balikin minimal 1 baris, seluruh
    // knowledge_base lain gak pernah ikut dipertimbangkan lagi -- padahal
    // full-text search Postgres gampang meleset buat kalimat percakapan
    // ("kalau saya beli sekarang kapan masuknya ya"). Hasilnya NexBot
    // ngejawab "informasi belum tersedia" padahal jawabannya ADA di
    // knowledge base. Sekarang dua sumbernya digabung, biar ranker yang
    // nentuin mana yang relevan.
    // Kedua query jalan paralel dan dibatasi waktu. BUILTIN_KNOWLEDGE tetap
    // tersedia jika Supabase sedang lambat, jadi chat tidak boleh ikut macet.
    const rpcTask = Promise.resolve(
        supabase.rpc("search_nexbot_knowledge", { search_query: query.raw, result_limit: 80 })
    ).catch(() => ({ data: [], error: true }));
    const baseTask = Promise.resolve(
        supabase
            .from("knowledge_base")
            .select(knowledgeColumns())
            .eq("status", "active")
            .order("priority", { ascending: false })
            .limit(500)
    ).catch(() => ({ data: [], error: true }));

    const [rpc, base] = await Promise.all([
        resolveWithin(rpcTask, NEXBOT_DB_TIMEOUT_MS, { data: [], error: true }),
        resolveWithin(baseTask, NEXBOT_DB_TIMEOUT_MS, { data: [], error: true })
    ]);
    const rpcRows = !rpc.error && Array.isArray(rpc.data) ? rpc.data : [];
    const baseRows = !base.error && Array.isArray(base.data) ? base.data : [];

    // Gabung + buang duplikat berdasarkan id (baris RPC dan baris tabel bisa
    // nunjuk entri yang sama).
    const merged = new Map();
    [...rpcRows, ...baseRows, ...BUILTIN_KNOWLEDGE].forEach((row) => {
        if (!row) return;
        const key = String(row.id ?? row.title ?? "");
        if (key && !merged.has(key)) merged.set(key, row);
    });

    return [...merged.values()];
}

async function loadConversationMemory(sessionId, userId) {
    const filters = supabase.from("ai_conversations").select("role,message,intent,created_at").eq("session_id", sessionId).order("created_at", { ascending: false }).limit(6);
    const [conversationResult, userResult] = await Promise.allSettled([
        resolveWithin(filters, NEXBOT_DB_TIMEOUT_MS, { data: [], error: true }),
        userId
            ? resolveWithin(
                supabase.from("ai_user_memories").select("favorite_game,custom_preferences").eq("user_id", String(userId)).maybeSingle(),
                NEXBOT_DB_TIMEOUT_MS,
                { data: null, error: true }
            )
            : Promise.resolve({ data: null })
    ]);
    const conversation = conversationResult.status === "fulfilled" && !conversationResult.value.error ? (conversationResult.value.data || []).reverse() : [];
    const userMemory = userResult.status === "fulfilled" && !userResult.value.error ? userResult.value.data : null;
    return { conversation, userMemory };
}

function memoryEntities(query, memory) {
    if (detectEntities(query).length || !memory.conversation.length) return [];
    const recentCustomerMessage = [...memory.conversation].reverse().find((item) => item.role === "user")?.message || "";
    const favorite = memory.userMemory?.favorite_game || "";
    return detectEntities(normalizeQuery(`${recentCustomerMessage} ${favorite}`));
}

// Riwayat percakapan SUDAH diambil (loadConversationMemory) tapi dulu cuma
// dipakai buat nebak entity -- isinya gak pernah sampai ke model. Akibatnya
// tiap pertanyaan lanjutan diperlakukan sebagai percakapan baru: "kalau yang
// 1 tahun berapa?" atau "kalau yang itu gimana?" kehilangan konteksnya total
// dan NexBot jawab ngawur/minta diulang.
//
// Driver provider (Groq/Gemini/OpenRouter) cuma nerima satu string prompt,
// jadi transkrip ditempel di depan pertanyaan terakhir.
const MAX_HISTORY_TURNS = 4;
const MAX_HISTORY_CHARS = 400;

function buildConversationPrompt(memory, message) {
    const turns = (memory?.conversation || []).slice(-MAX_HISTORY_TURNS);
    if (!turns.length) return message;

    const transcript = turns
        .map((turn) => {
            const who = turn.role === "assistant" ? "NexBot" : "Customer";
            const text = String(turn.message || "").replace(/\s+/g, " ").trim().slice(0, MAX_HISTORY_CHARS);
            return text ? `${who}: ${text}` : "";
        })
        .filter(Boolean)
        .join("\n");

    if (!transcript) return message;

    return `PERCAKAPAN SEBELUMNYA (konteks, jangan dijawab ulang):\n${transcript}\n\nPERTANYAAN CUSTOMER SEKARANG:\n${message}`;
}

async function retrieveKnowledge(message, sessionId, user) {
    const query = normalizeQuery(message);
    const intent = detectIntent(query);
    const [memory, knowledge] = await Promise.all([
        loadConversationMemory(sessionId, user?.id),
        loadKnowledge(query)
    ]);
    const entities = [...new Set([...detectEntities(query), ...memoryEntities(query, memory)])];
    const selected = rankKnowledge(knowledge, query, intent, entities);
    return { query, intent, entities, memory, selected };
}

async function saveConversation({ userId, sessionId, role, message, intent, knowledgeIds }) {
    const payload = {
        user_id: userId ? String(userId) : null,
        session_id: sessionId,
        role,
        message: safeMessage(message),
        intent,
        knowledge_ids: knowledgeIds || []
    };
    try { await resolveWithin(supabase.from("ai_conversations").insert(payload), NEXBOT_DB_TIMEOUT_MS, null); } catch (_) { /* analytics/memory must never break chat */ }
}

async function updateUserMemory(user, query, intent, entities) {
    if (!user?.id) return;
    const favoriteGame = entities.find((entity) => /Mobile Legends|Free Fire|PUBG|Valorant|Xbox|Steam|Nintendo|PlayStation/.test(entity)) || null;
    const payload = {
        user_id: String(user.id),
        favorite_game: favoriteGame,
        custom_preferences: { last_query: query.raw, last_intent: intent, last_entities: entities },
        last_seen_at: new Date().toISOString()
    };
    try { await resolveWithin(supabase.from("ai_user_memories").upsert(payload, { onConflict: "user_id" }), NEXBOT_DB_TIMEOUT_MS, null); } catch (_) { /* optional personalization */ }
}

async function saveAnalytics({ query, intent, entities, selected, source, failed, user, sessionId }) {
    const payload = {
        normalized_query: query.raw,
        intent,
        entities,
        knowledge_ids: selected.map((item) => String(item.id)),
        response_source: source,
        is_failed: failed,
        user_id: user?.id ? String(user.id) : null,
        session_id: sessionId
    };
    try { await resolveWithin(supabase.from("ai_query_analytics").insert(payload), NEXBOT_DB_TIMEOUT_MS, null); } catch (_) { /* analytics is non-blocking */ }
}

// ============================================================================
// FEATURE: "Hubungi Customer Service" -- SENGAJA dijawab langsung dari
// store_settings (BUKAN dilempar ke LLM/knowledge base), supaya nomor
// WhatsApp/email/Instagram yang dikirim NexBot SELALU sama persis dengan
// yang ditampilkan di halaman Contact Us. Kalau ini lewat LLM, ada risiko
// model salah kutip nomor lama dari knowledge yang belum di-update, atau
// malah bilang "tidak tersedia" walau datanya sebenarnya ada.
// ============================================================================

function isContactQuery(rawMessage) {
    const t = String(rawMessage || "").toLowerCase();
    return /(hubungi|kontak|contact)\s*(cs|customer service|admin|kami)?|customer service|hubungi\s*cs|nomor\s*(wa|whatsapp|admin|cs)|sosmed|social\s*media|instagram|hubungi\s*admin/.test(t);
}

async function handleContactQuery() {
    const settings = await getStoreSettings();
    const lines = [];

    if (settings.contact_whatsapp) {
        const cleanWa = String(settings.contact_whatsapp).replace(/\D/g, "");
        const label = settings.contact_phone || settings.contact_whatsapp;
        lines.push(`- WhatsApp: [${label}](https://wa.me/${cleanWa})`);
    }
    if (settings.contact_email) {
        const emails = String(settings.contact_email).split(",").map((e) => e.trim()).filter(Boolean).slice(0, 2);
        emails.forEach((email) => lines.push(`- Email: ${email}`));
    }
    if (settings.contact_instagram) {
        const handle = String(settings.contact_instagram).replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/$/, "");
        lines.push(`- Instagram: [@${handle.replace(/^@/, "")}](https://www.instagram.com/${handle.replace(/^@/, "")})`);
    }

    if (!lines.length) return unavailableReply();

    return `Kamu bisa menghubungi Customer Service NexShop resmi lewat channel berikut:\n\n${lines.join("\n")}\n\nSemua channel di atas sama persis dengan yang tercantum di halaman Kontak NexShop.`;
}

function unavailableReply() {
    return "Maaf, informasi untuk pertanyaan tersebut belum tersedia. Agar kami dapat membantu dengan tepat, silakan hubungi Customer Service NexShop dengan detail pertanyaan atau Nomor Order ID Anda.";
}

// Kalimat fallback yang di-hardcode di systemPrompt (JIKA BAGIAN "FAKTA
// KNOWLEDGE BASE" KOSONG). Kadang model tetap menempelkan kalimat ini di
// belakang jawaban asli walau sudah dikasih fakta relevan (retrieval sudah
// selected.length > 0) -- hasilnya jawaban jadi kontradiktif/pecah 2 "pesan"
// di UI. Karena kita SUDAH TAHU ada fakta relevan, kalimat fallback yang
// nyasar itu aman dibuang tanpa mengubah makna jawaban asli.
const STRAY_FALLBACK_TEXT = "Maaf, informasi tersebut belum tersedia di knowledge NexShop. Kamu bisa menghubungi Customer Service NexShop untuk informasi lebih lanjut.";
const STRAY_FALLBACK_PATTERN = /(?:mohon\s+)?maaf[^\n.!?]{0,120}(?:informasi|jawaban|data)[^\n.!?]{0,80}(?:belum|tidak)[^\n.!?]{0,80}(?:tersedia|ada)(?:[^\n.!?]*(?:knowledge|pengetahuan|nexshop))?[.!?]?/gi;

function stripStrayFallback(reply, hasKnowledge) {
    const trimmed = String(reply || "").trim();
    if (!hasKnowledge) return trimmed;
    // Jika model menolak secara persis padahal fakta tersedia, kembalikan
    // string kosong agar pemanggil memakai renderer knowledge lokal.
    if (trimmed === STRAY_FALLBACK_TEXT) return "";
    if (trimmed.includes(STRAY_FALLBACK_TEXT) || STRAY_FALLBACK_PATTERN.test(trimmed)) {
        STRAY_FALLBACK_PATTERN.lastIndex = 0;
        const cleaned = trimmed
            .split(STRAY_FALLBACK_TEXT).join("")
            .replace(STRAY_FALLBACK_PATTERN, "")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
        return cleaned;
    }
    return trimmed;
}

// Jika provider AI sedang bermasalah, fakta RAG yang sudah ditemukan tetap
// harus bisa menjawab customer. Sebelumnya semua fakta ini dibuang dan user
// justru menerima "informasi belum tersedia". Ambil kandidat teratas yang
// sudah lolos ranker/evidence gate, lalu tampilkan isinya tanpa menambah fakta.
function renderKnowledgeFallback(selected) {
    const paragraphs = (selected || [])
        .slice(0, 2)
        .map((item) => String(item.content || "").trim())
        .filter(Boolean);
    return paragraphs.join("\n\n") || unavailableReply();
}

function localConversationFallback(message) {
    const text = String(message || "").toLowerCase();
    if (/^(halo|hai|hi|hello|pagi|siang|sore|malam)\b/.test(text)) {
        return "Halo! Saya NexBot. Kamu bisa bertanya tentang produk, harga terkini, cara checkout, pembayaran, status pesanan, Marketplace, atau program reseller NexShop.";
    }
    if (/\b(terima kasih|makasih|thanks|thank you)\b/.test(text)) {
        return "Sama-sama! Kalau masih ada yang ingin ditanyakan tentang NexShop, kirim saja pertanyaannya di sini.";
    }
    return "Aku belum memiliki fakta resmi yang cukup untuk memastikan jawaban itu. Coba tambahkan nama produk, layanan, atau Nomor Order ID yang dimaksud. Jika menyangkut transaksi tertentu, Customer Service NexShop dapat membantu pemeriksaan manual.";
}

async function answerWithoutKnowledge(message, result, user, sessionId) {
    const t = String(message || "").toLowerCase().trim();
    // Sapaan/thanks singkat boleh dijawab ramah tanpa knowledge, tapi tetap dalam konteks NexShop
    if (/^(halo|hi|hey|hai|selamat (pagi|siang|sore|malam)|thanks|terima kasih|makasih|good (morning|afternoon|evening)|hello)\b/i.test(t) && t.length < 40) {
        return { reply: "Halo! Saya NexBot, asisten resmi NexShop. Ada yang bisa saya bantu seputar produk, topup, pembayaran, Marketplace, atau layanan NexShop?", source: "greeting" };
    }
    // Pertanyaan yang masih berada di domain NexShop tetapi belum menemukan
    // fakta resmi dipisahkan dari pertanyaan luar domain. Dengan begitu
    // analytics bisa membedakan knowledge gap dari upaya meminta topik lain.
    return { reply: unavailableReply(), source: "knowledge_gap" };
}

async function handleOrderLookup(message, user) {
    const rawMsg = String(message || "").trim();

    // 1. Cek apakah ada Order ID (contoh: NX123... atau TP123...)
    const orderIdMatch = rawMsg.match(/\b(NX[A-F0-9]{10,30}|TP[A-F0-9]{10,30})\b/i);
    if (orderIdMatch) {
        const orderId = orderIdMatch[1].toUpperCase();

        const { data: regularOrder } = await supabase
            .from("orders")
            .select("id, status, total, items, created_at, paid_at")
            .eq("id", orderId)
            .maybeSingle();

        if (regularOrder) {
            const statusLabel = regularOrder.status === "paid" ? "✅ Berhasil (Lunas)" : regularOrder.status === "pending" ? "⏳ Menunggu Pembayaran" : "❌ Gagal / Batal";
            const itemsSummary = (regularOrder.items || []).map(i => `• ${i.name || 'Produk'} (x${i.qty || 1})`).join("\n");
            return `📦 **Detail Pesanan ${regularOrder.id}**\n\nStatus: **${statusLabel}**\nTotal: **Rp${Number(regularOrder.total || 0).toLocaleString("id-ID")}**\nTanggal: ${new Date(regularOrder.created_at).toLocaleString("id-ID")}\n\n**Item:**\n${itemsSummary}`;
        }

        const { data: topupOrder } = await supabase
            .from("topup_orders")
            .select("id, status, harga, nama_produk, tujuan, server_id, created_at")
            .eq("id", orderId)
            .maybeSingle();

        if (topupOrder) {
            const statusLabel = (topupOrder.status === "sukses" || topupOrder.status === "paid") ? "✅ Berhasil (Sukses)" : topupOrder.status === "pending" ? "⏳ Menunggu Pembayaran / Diproses" : "❌ Gagal";
            const targetInfo = topupOrder.tujuan + (topupOrder.server_id ? ` (${topupOrder.server_id})` : "");
            return `💎 **Detail Topup ${topupOrder.id}**\n\nProduk: **${topupOrder.nama_produk || '-'}**\nTujuan: **${targetInfo}**\nStatus: **${statusLabel}**\nTotal: **Rp${Number(topupOrder.harga || 0).toLocaleString("id-ID")}**\nTanggal: ${new Date(topupOrder.created_at).toLocaleString("id-ID")}`;
        }

        return `Nomor Order ID **${orderId}** tidak ditemukan di sistem NexShop. Mohon periksa kembali nomor order Anda atau hubungi CS WhatsApp jika membutuhkan bantuan.`;
    }

    // 2. Cek apakah ada alamat Email di dalam pesan
    const emailMatch = rawMsg.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    if (emailMatch) {
        const email = emailMatch[1].toLowerCase();
        const [ordersRes, topupRes] = await Promise.all([
            supabase.from("orders").select("id, status, total, items, created_at").eq("recipient_email", email).order("created_at", { ascending: false }).limit(3),
            supabase.from("topup_orders").select("id, status, harga, nama_produk, created_at").eq("recipient_email", email).order("created_at", { ascending: false }).limit(3)
        ]);

        const regList = (ordersRes.data || []).map(o => ({ id: o.id, title: (o.items || []).map(i => i.name).join(", ") || "Pesanan Produk", total: o.total, status: o.status, date: o.created_at }));
        const topList = (topupRes.data || []).map(t => ({ id: t.id, title: t.nama_produk || "Topup Game", total: t.harga, status: t.status, date: t.created_at }));
        const combined = [...regList, ...topList].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 3);

        if (combined.length) {
            const listText = combined.map(item => `• **${item.id}** — ${item.title}\n  Total: Rp${Number(item.total).toLocaleString("id-ID")} | Status: **${item.status}**`).join("\n\n");
            return `📋 **Riwayat Pesanan untuk ${email}:**\n\n${listText}`;
        }

        return `Tidak ditemukan pesanan dengan email **${email}**. Mohon pastikan alamat email yang Anda masukkan sesuai dengan saat checkout.`;
    }

    // 3. Jika user sedang terautentikasi (login)
    if (user?.id) {
        const [ordersRes, topupRes] = await Promise.all([
            supabase.from("orders").select("id, status, total, items, created_at").eq("user_id", String(user.id)).order("created_at", { ascending: false }).limit(3),
            supabase.from("topup_orders").select("id, status, harga, nama_produk, created_at").eq("user_id", String(user.id)).order("created_at", { ascending: false }).limit(3)
        ]);

        const regList = (ordersRes.data || []).map(o => ({ id: o.id, title: (o.items || []).map(i => i.name).join(", ") || "Pesanan Produk", total: o.total, status: o.status, date: o.created_at }));
        const topList = (topupRes.data || []).map(t => ({ id: t.id, title: t.nama_produk || "Topup Game", total: t.harga, status: t.status, date: t.created_at }));
        const combined = [...regList, ...topList].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 3);

        if (combined.length) {
            const listText = combined.map(item => `• **${item.id}** — ${item.title}\n  Total: Rp${Number(item.total).toLocaleString("id-ID")} | Status: **${item.status}**`).join("\n\n");
            return `📦 **Status Pesanan Terbaru Anda:**\n\n${listText}\n\nKetik Nomor Order ID spesifik untuk detail lengkap.`;
        }

        return `Akun Anda belum memiliki riwayat transaksi di NexShop. Jika Anda melakukan pemesanan tanpa login (Guest Checkout), silakan kirimkan **Nomor Order ID** (contoh: \`NX...\` atau \`TP...\`) atau alamat **Email** transaksi Anda.`;
    }

    // 4. Guest user tanpa Order ID / Email di pesan
    return `Untuk mengecek **Status Pesanan Saya**, silakan kirimkan **Nomor Order ID** Anda (contoh: \`NX...\` atau \`TP...\`), atau alamat **Email** yang Anda gunakan saat bertransaksi.\n\nAnda juga dapat mengecek status pesanan secara langsung melalui menu **Cek Transaksi** pada bagian atas website atau menghubungi CS WhatsApp kami.`;
}

async function answer(message, sessionId, user) {
    const templateKnowledge = getTemplateKnowledge(message);
    const isContact = isContactQuery(message);
    const isBudgetQuery = !isContact && isBudgetQuestion(message);
    // Intent Order juga mencakup pertanyaan informasional seperti "berapa
    // lama diproses?". Hanya masuk ke lookup transaksi jika user benar-benar
    // meminta status miliknya atau mengirim identitas order.
    const isOrderQuery = !isContact && !isBudgetQuery && (
        /\b(NX[A-F0-9]{10,30}|TP[A-F0-9]{10,30})\b/i.test(message)
        || /status\s+(pesanan|order)(\s+saya)?|lacak\s+(pesanan|order)|pesanan\s+saya|cek\s+(pesanan|order)/i.test(message)
    );
    const normalized = normalizeQuery(message);
    const preRagResult = {
        query: normalized,
        intent: detectIntent(normalized),
        entities: detectEntities(normalized),
        memory: { conversation: [], userMemory: null },
        selected: []
    };
    // Hard scope boundary: this runs before conversation memory, knowledge
    // retrieval, and provider calls. The only allowed pre-RAG read is a price
    // catalog probe for dynamically named products.
    const preRagScope = isNexShopScope(message, preRagResult);
    const preRagPriceReply = (!preRagScope && nexbotCatalog.isPriceQuestion(message))
        ? await resolveWithin(handlePriceQuery(message, user), NEXBOT_DB_TIMEOUT_MS, null)
        : null;
    const scopeEstablished = preRagScope || Boolean(preRagPriceReply);
    if (!scopeEstablished) {
        const reply = formatProfessionalReply(OUT_OF_SCOPE_REPLY);
        return {
            reply,
            source: "out_of_scope",
            handoff: false,
            intent: preRagResult.intent,
            entities: preRagResult.entities,
            knowledgeIds: []
        };
    }

    const directPath = templateKnowledge || isContact || isBudgetQuery || isOrderQuery;
    const result = directPath
        ? { ...preRagResult, selected: templateKnowledge ? [templateKnowledge] : [] }
        : await retrieveKnowledge(message, sessionId, user);

    let reply = "";
    let source = "knowledge";
    const priceReply = preRagPriceReply || (!templateKnowledge && !isContact && !isBudgetQuery && !isOrderQuery
        ? await resolveWithin(handlePriceQuery(message, user), NEXBOT_DB_TIMEOUT_MS, null)
        : null);
    if (templateKnowledge) {
        reply = renderKnowledgeFallback([templateKnowledge]);
        source = "template_knowledge";
    } else if (isContact) {
        reply = await resolveWithin(handleContactQuery(), NEXBOT_DB_TIMEOUT_MS, localConversationFallback(message));
        source = "contact_info";
    } else if (isBudgetQuery) {
        reply = await resolveWithin(handleBudgetQuery(message), NEXBOT_DB_TIMEOUT_MS * 2, localConversationFallback(message));
        source = "price_calculator";
    } else if (isOrderQuery) {
        reply = await resolveWithin(handleOrderLookup(message, user), NEXBOT_DB_TIMEOUT_MS * 2, "Pemeriksaan pesanan sedang lambat. Coba lagi sebentar atau cek melalui menu Cek Transaksi menggunakan Nomor Order ID kamu.");
        source = "order_system";
    } else if (priceReply) {
        reply = priceReply;
        source = "price_catalog";
    } else {
        if (process.env.NODE_ENV !== "production") {
            console.log("\n[AI RAG DEBUG]");
            console.log("Query:", message);
            console.log("Intent:", result.intent);
            console.log("Selected Chunks:", result.selected.map(i => i.title).join(", ") || "None");
        }

        if (result.selected.length === 0) {
            const general = await answerWithoutKnowledge(message, result, user, sessionId);
            reply = general.reply;
            source = general.source;
        } else {
            const knowledgeText = buildKnowledgeResponse(result.selected);
            const systemPrompt = `ROLE
Kamu adalah NexBot, asisten AI resmi NexShop.

MISSION
Bantu customer memahami layanan NexShop berdasarkan informasi resmi NexShop di bawah.

RULES
1. Jawab HANYA berdasarkan fakta di "FAKTA KNOWLEDGE BASE" di bawah. Fakta-fakta itu sudah dipilih sistem karena relevan dengan pertanyaan customer -- TUGASMU MERANGKAI JAWABAN DARI FAKTA TERSEBUT, BUKAN menilai ulang apakah fakta itu relevan atau tidak. Selama ada minimal satu fakta di bawah, kamu WAJIB menjawab pakai fakta itu, jangan menolak.
2. Kalimat fallback di paling bawah HANYA dipakai kalau bagian "FAKTA KNOWLEDGE BASE" benar-benar KOSONG. Jangan pernah menggabungkan kalimat fallback dengan jawaban lain dalam respons yang sama -- pilih salah satu saja.
3. Jangan mengubah dokumen legal menjadi jaminan hukum absolut.
4. Gunakan bahasa yang objektif dan faktual, BUKAN bahasa marketing.
5. DILARANG KERAS menggunakan klaim mutlak seperti "100% aman", "100% legal", atau "pasti terpercaya". Gunakan kata-kata objektif (mis. "terdaftar resmi", "menggunakan mekanisme escrow untuk transaksi yang mendukungnya").
6. Jawaban harus natural dalam Bahasa Indonesia dengan gaya Customer Service ("Ya, ...", "Untuk pembayaran, ...").
7. Jangan menyebut istilah internal seperti database, RAG, chunk, embedding, retrieval, atau referensi sumber.
8. FORMAT WAJIB -- ini penting, jangan tulis semua fakta jadi satu paragraf panjang:
   - Struktur jawaban: 1 kalimat pembuka yang langsung menjawab, lalu rincian (bullet/daftar) kalau ada lebih dari satu poin, lalu 1 kalimat penutup singkat kalau memang perlu.
   - Pisahkan tiap topik/ide jadi paragraf sendiri, dengan BARIS KOSONG (enter dua kali) di antar paragraf. Satu paragraf maksimal 2 kalimat.
   - Beberapa poin/langkah/daftar (mis. metode pembayaran, langkah beli produk, rincian nomor legal) WAJIB jadi bullet "- " satu poin per baris, jangan digabung koma dalam satu kalimat.
   - Langkah yang berurutan pakai daftar bernomor "1." "2." "3.", bukan bullet.
   - Data berpasangan (nomor izin, status, tanggal, nominal) tulis satu baris per data dengan format "Label: nilai" -- mis. "NIB: 1408260072494". Jangan menumpuk beberapa label dalam satu baris.
   - Tebalkan (**...**) hanya untuk nilai/istilah penting, maksimal beberapa kata. Jangan menebalkan satu kalimat penuh.
   - Panjang jawaban ideal 40-120 kata. Jangan mengulang pertanyaan customer di awal jawaban.
9. Jangan menggunakan heading markdown, tabel, atau emoji dekoratif yang tidak perlu. Maksimal satu emoji, dan hanya kalau benar-benar membantu.

--- FAKTA KNOWLEDGE BASE ---
${knowledgeText}
----------------------------

JIKA BAGIAN "FAKTA KNOWLEDGE BASE" DI ATAS KOSONG (tidak ada fakta sama sekali):
Jawab persis kalimat ini SAJA, tanpa tambahan apapun: "Maaf, informasi tersebut belum tersedia di knowledge NexShop. Kamu bisa menghubungi Customer Service NexShop untuk informasi lebih lanjut."`;

            const aiRes = await resolveWithin(
                aiProviderManager.generateResponse({
                    prompt: buildConversationPrompt(result.memory, message),
                    systemPrompt,
                    userId: user?.id,
                    sessionId
                }),
                NEXBOT_AI_TIMEOUT_MS,
                { success: false, reply: null, error: "AI provider timeout" }
            );

            if (aiRes.success && aiRes.reply) {
                const cleanedReply = stripStrayFallback(aiRes.reply, result.selected.length > 0);
                reply = cleanedReply || renderKnowledgeFallback(result.selected);
                source = cleanedReply ? aiRes.provider : "knowledge_fallback";
            } else {
                console.error("❌ AI Provider Manager failed for prompt:", message);
                console.error("   Error details:", aiRes.error);
                reply = renderKnowledgeFallback(result.selected);
                source = "knowledge_fallback";
            }
        }
    }

    // Setiap jalur (template, katalog, provider AI, fallback, dan handoff)
    // melewati formatter yang sama agar kontrak visual NexBot konsisten.
    reply = formatProfessionalReply(reply);

    const knowledgeIds = result.selected.map((item) => String(item.id));
    // Penyimpanan memory/analytics tidak boleh menahan jawaban ke browser.
    // Semua fungsi sudah fail-safe; Promise.allSettled mencegah rejection liar.
    void Promise.allSettled([
        saveConversation({ userId: user?.id, sessionId, role: "user", message, intent: result.intent, knowledgeIds }),
        saveConversation({ userId: user?.id, sessionId, role: "assistant", message: reply, intent: result.intent, knowledgeIds }),
        updateUserMemory(user, result.query, result.intent, result.entities),
        saveAnalytics({ ...result, source, failed: source === "safe_fallback" || source === "handoff", user, sessionId })
    ]);
    return { reply, source, handoff: source === "handoff" || source === "safe_fallback", intent: result.intent, entities: result.entities, knowledgeIds };
}

exports.chat = async (req, res) => {
    const message = safeMessage(req.body.message);
    if (!message) return res.status(400).json({ message: "Pesan tidak boleh kosong" });
    const sessionId = safeSessionId(req.body.session_id || req.headers["x-session-id"]);
    try {
        const result = await resolveWithin(
            answer(message, sessionId, req.user || null),
            NEXBOT_CHAT_TIMEOUT_MS,
            {
                reply: "Respons NexBot membutuhkan waktu terlalu lama. Silakan kirim ulang pertanyaanmu; untuk status transaksi, sertakan Nomor Order ID agar bisa diperiksa langsung.",
                source: "request_timeout",
                handoff: false,
                intent: "TechnicalSupport",
                knowledgeIds: []
            }
        );
        return res.json({ reply: result.reply, session_id: sessionId, handoff: result.handoff, source: result.source, intent: result.intent, knowledge_ids: result.knowledgeIds });
    } catch (error) {
        console.error("❌ NexBot chat error stack:", error.stack || error);
        const errorMessage = process.env.NODE_ENV !== "production"
            ? `NexBot Error: ${error.message}`
            : "NexBot sedang mengalami kendala. Silakan coba lagi.";
        return res.status(500).json({ message: errorMessage, error: error.message });
    }
};

// Quick actions use exactly the same retrieval and direct knowledge renderer,
// but never invoke an LLM. This also makes their latency predictable.
exports.quickAction = async (req, res) => {
    const action = String(req.params.action || "").toLowerCase();
    const message = QUICK_ACTIONS[action];
    if (!message) return res.status(404).json({ message: "Quick action tidak ditemukan" });
    const sessionId = safeSessionId(req.headers["x-session-id"]);
    try {
        const result = await answer(message, sessionId, req.user || null);
        return res.json({ ...result, session_id: sessionId });
    } catch (error) {
        console.error("NexBot quick action error:", error.message);
        return res.status(500).json({ message: "Quick action sedang mengalami kendala" });
    }
};

exports.getKnowledgeBase = async (_req, res) => {
    const { data, error } = await supabase.from("knowledge_base").select("*").order("priority", { ascending: false });
    if (error) return res.status(503).json({ message: "Knowledge Base belum tersedia. Jalankan migrasi NexBot terlebih dahulu." });
    return res.json({ data: data || [] });
};

function knowledgePayload(body, partial = false) {
    const value = {};
    ["title", "category", "keywords", "content"].forEach((key) => {
        if (body[key] !== undefined) value[key] = String(body[key]).trim();
    });
    if (body.status !== undefined) value.status = ["active", "inactive", "draft"].includes(body.status) ? body.status : "draft";
    if (body.priority !== undefined) value.priority = Math.max(0, Math.min(100, Number(body.priority) || 0));
    if (!partial && (!value.title || !value.content)) return null;
    return value;
}

exports.createKnowledgeBase = async (req, res) => {
    const payload = knowledgePayload(req.body);
    if (!payload) return res.status(400).json({ message: "Judul dan konten wajib diisi" });
    const { data, error } = await supabase.from("knowledge_base").insert(payload).select().single();
    if (error) return res.status(503).json({ message: "Gagal menyimpan knowledge", detail: error.message });
    return res.status(201).json({ message: "Knowledge berhasil ditambahkan", data });
};

function isValidUuid(value) {
    return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

exports.updateKnowledgeBase = async (req, res) => {
    if (!isValidUuid(req.params.id)) {
        return res.status(400).json({ message: "ID Knowledge Base tidak valid" });
    }
    const payload = knowledgePayload(req.body, true);
    if (!Object.keys(payload).length) return res.status(400).json({ message: "Tidak ada perubahan valid" });
    const { data, error } = await supabase.from("knowledge_base").update(payload).eq("id", req.params.id).select().maybeSingle();
    if (error) return res.status(503).json({ message: "Gagal memperbarui knowledge", detail: error.message });
    if (!data) return res.status(404).json({ message: "Knowledge tidak ditemukan" });
    return res.json({ message: "Knowledge berhasil diperbarui", data });
};

exports.deleteKnowledgeBase = async (req, res) => {
    if (!isValidUuid(req.params.id)) {
        return res.status(400).json({ message: "ID Knowledge Base tidak valid" });
    }
    const { data, error } = await supabase.from("knowledge_base").delete().eq("id", req.params.id).select("id").maybeSingle();
    if (error) return res.status(503).json({ message: "Gagal menghapus knowledge", detail: error.message });
    if (!data) return res.status(404).json({ message: "Knowledge tidak ditemukan" });
    return res.json({ message: "Knowledge berhasil dihapus" });
};

exports.refreshKnowledgeBase = async (req, res) => {
    try {
        const { execFile } = require('child_process');
        const path = require('path');
        const scriptPath = path.join(__dirname, '../scripts/ingest-website.js');
        
        execFile(process.execPath, [scriptPath, "web"], { timeout: 10 * 60 * 1000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
            if (error) {
                console.error(`Ingestion Error: ${error.message}`);
            }
            console.log(`Ingestion Output: ${stdout}`);
        });

        return res.json({ 
            success: true, 
            message: "Knowledge base refresh sedang berjalan di background (Web Ingestion)." 
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

// Rebuild only stable store facts. Existing knowledge is preserved so manually
// authored, product-specific facts cannot be overwritten by an AI generator.
exports.reseedKnowledgeBase = async (_req, res) => {
    try {
        const settings = await getStoreSettings({ fresh: true });
        const generated = BUILTIN_KNOWLEDGE.map(({ id, ...item }) => item);
        if (settings.refund_content) generated.push({ title: "Kebijakan Refund NexShop", category: "Policy", keywords: "refund pengembalian dana garansi komplain", content: String(settings.refund_content), priority: 10, status: "active" });
        const { data, error } = await supabase.from("knowledge_base").upsert(generated, { onConflict: "title" }).select();
        if (error) return res.status(503).json({ message: "Gagal membangun knowledge", detail: error.message });
        return res.json({ message: "Knowledge resmi berhasil diperbarui", count: data?.length || 0 });
    } catch (error) { return res.status(500).json({ message: "Gagal membangun knowledge" }); }
};

exports.generateProductFaqs = async (_req, res) => res.status(410).json({ message: "Generator FAQ otomatis dinonaktifkan untuk menjaga fakta knowledge. Tambahkan knowledge produk melalui dashboard." });

exports.getAnalytics = async (_req, res) => {
    const { data, error } = await supabase.from("ai_query_analytics").select("normalized_query,intent,knowledge_ids,is_failed,created_at").order("created_at", { ascending: false }).limit(1000);
    if (error) return res.status(503).json({ message: "Analitik NexBot belum tersedia. Jalankan migrasi NexBot terlebih dahulu." });
    const rows = data || []; const countBy = (key) => Object.entries(rows.reduce((acc, row) => { const value = row[key] || "Tidak diketahui"; acc[value] = (acc[value] || 0) + 1; return acc; }, {})).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 10);
    const missing = rows.filter((row) => row.is_failed).reduce((acc, row) => { acc[row.normalized_query] = (acc[row.normalized_query] || 0) + 1; return acc; }, {});
    return res.json({ total_questions: rows.length, failed_questions: rows.filter((row) => row.is_failed).length, popular_questions: countBy("normalized_query"), intents: countBy("intent"), missing_knowledge: Object.entries(missing).map(([query, count]) => ({ query, count, recommendation: `Tambahkan knowledge untuk: ${query}` })).sort((a, b) => b.count - a.count).slice(0, 10) });
};

exports.testGeminiConnection = async (req, res) => {
    try {
        const result = await aiProviderManager.testSingleProvider("gemini", req.user?.id);
        return res.status(result.success ? 200 : (result.httpStatus || 500)).json(result);
    } catch (err) {
        return res.status(500).json({ success: false, connected: false, message: err.message || "Gagal melakukan uji koneksi Gemini" });
    }
};

exports.getGeminiStatus = async (_req, res) => {
    try {
        const keys = await getApiKeys();
        const apiKey = keys.gemini_api_key || process.env.GEMINI_API_KEY || "";
        const preferredModel = keys.gemini_news_model || DEFAULT_GEMINI_MODEL;

        const { data: logs, error } = await supabase
            .from("ai_gemini_logs")
            .select("is_success, response_time_ms, http_status, error_message, model_used, created_at")
            .order("created_at", { ascending: false })
            .limit(500);

        if (error) {
            console.warn("Error fetching ai_gemini_logs:", error.message);
        }

        const rows = logs || [];
        const totalRequests = rows.length;
        const successfulRequests = rows.filter((r) => r.is_success).length;
        const failedRequests = totalRequests - successfulRequests;
        const successRate = totalRequests > 0 ? Number(((successfulRequests / totalRequests) * 100).toFixed(1)) : 100.0;

        const lastSuccess = rows.find((r) => r.is_success)?.created_at || null;
        const lastFailed = rows.find((r) => !r.is_success);
        const lastFailedAt = lastFailed?.created_at || null;
        const lastError = lastFailed?.error_message || null;

        const validLatencies = rows.map((r) => r.response_time_ms).filter((t) => Number.isInteger(t) && t > 0);
        const avgLatencyMs = validLatencies.length ? Math.round(validLatencies.reduce((a, b) => a + b, 0) / validLatencies.length) : 0;

        const isConnected = !!apiKey && (totalRequests === 0 || (rows[0] && rows[0].is_success));
        const activeModel = rows[0]?.model_used || preferredModel;

        return res.json({
            connected: isConnected,
            has_api_key: !!apiKey,
            model: activeModel,
            masked_key: maskKey(apiKey),
            total_requests: totalRequests,
            successful_requests: successfulRequests,
            failed_requests: failedRequests,
            success_rate: successRate,
            last_successful_request: lastSuccess,
            last_failed_request: lastFailedAt,
            last_error: lastError,
            avg_response_time_ms: avgLatencyMs
        });
    } catch (err) {
        return res.status(500).json({ message: "Gagal mengambil status Gemini AI" });
    }
};

exports.getGeminiLogs = async (_req, res) => {
    try {
        const { data, error } = await supabase
            .from("ai_gemini_logs")
            .select("*")
            .order("created_at", { ascending: false })
            .limit(100);

        if (error) {
            return res.status(503).json({ message: "Tabel log Gemini belum tersedia. Jalankan migrations-22-gemini-monitoring.sql di Supabase." });
        }

        return res.json({ data: data || [] });
    } catch (err) {
        return res.status(500).json({ message: "Gagal mengambil log Gemini AI" });
    }
};

// ===================================
// MULTI-AI PROVIDER ADMIN HANDLERS
// ===================================

exports.getAdminAiStatus = async (_req, res) => {
    try {
        const status = await aiProviderManager.getOverallStatus();
        return res.json(status);
    } catch (err) {
        return res.status(500).json({ message: "Gagal mengambil status AI Provider", detail: err.message });
    }
};

exports.getAdminAiLogs = async (req, res) => {
    try {
        const { provider, status, date, limit } = req.query;
        const logs = await aiProviderManager.getFilteredLogs({
            provider: provider || "all",
            status: status || "all",
            date: date || null,
            limit: Math.min(200, Number(limit) || 100)
        });
        return res.json({ data: logs });
    } catch (err) {
        return res.status(500).json({ message: "Gagal mengambil log AI Provider", detail: err.message });
    }
};

exports.testAdminAiProviders = async (req, res) => {
    try {
        const { provider_id } = req.body || {};
        if (provider_id) {
            const result = await aiProviderManager.testSingleProvider(provider_id, req.user?.id);
            return res.json(result);
        }
        const results = await aiProviderManager.testAllProviders(req.user?.id);
        return res.json({ success: true, providers: results });
    } catch (err) {
        return res.status(500).json({ message: "Gagal melakukan test koneksi AI Provider", detail: err.message });
    }
};

exports.updateAdminAiProvider = async (req, res) => {
    try {
        const { id, model, priority, enabled, http_referer, app_name } = req.body || {};
        if (!id) return res.status(400).json({ message: "ID Provider wajib diisi" });

        const updated = await aiProviderManager.saveProviderSetting({ id, model, priority, enabled, http_referer, app_name });
        return res.json({ message: `Pengaturan ${id} berhasil diperbarui`, data: updated });
    } catch (err) {
        return res.status(500).json({ message: err.message || "Gagal memperbarui pengaturan provider" });
    }
};

exports.saveAdminAiApiKey = async (req, res) => {
    try {
        const { id, api_key, model, priority, enabled, http_referer, referer, app_name } = req.body || {};
        if (!id) return res.status(400).json({ success: false, message: "ID Provider wajib diisi" });

        const updated = await aiProviderManager.saveProviderSetting({
            id,
            api_key,
            model,
            priority,
            enabled,
            http_referer: http_referer || referer,
            app_name
        });
        return res.json({
            success: true,
            message: `Konfigurasi ${id} berhasil disimpan`,
            data: updated,
            masked_key: aiProviderManager.maskKey(updated.api_key)
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message || "Gagal menyimpan konfigurasi AI Provider" });
    }
};

exports.getAdminAiConfig = async (_req, res) => {
    try {
        const providers = await aiProviderManager.loadProviderSettings({ fresh: true });
        const sanitized = providers.map((p) => ({
            id: p.id,
            provider: p.provider,
            api_key: p.api_key,
            masked_key: aiProviderManager.maskKey(p.api_key),
            model: p.model,
            enabled: p.enabled,
            priority: p.priority,
            referer: p.http_referer,
            http_referer: p.http_referer,
            app_name: p.app_name,
            updated_at: p.updated_at
        }));
        return res.json({ success: true, data: sanitized, config: sanitized });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

exports.saveAdminAiConfig = async (req, res) => {
    try {
        const body = req.body || {};
        const configs = Array.isArray(body) ? body : (body.providers || [body]);
        const results = [];

        for (const item of configs) {
            if (item && item.id) {
                const updated = await aiProviderManager.saveProviderSetting({
                    id: item.id,
                    api_key: item.api_key ?? item.apiKey,
                    model: item.model,
                    priority: item.priority,
                    enabled: item.enabled,
                    http_referer: item.http_referer ?? item.referer,
                    app_name: item.app_name ?? item.appName
                });
                results.push(updated);
            }
        }

        return res.json({
            success: true,
            message: "Konfigurasi AI Provider berhasil disimpan",
            data: results
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};
