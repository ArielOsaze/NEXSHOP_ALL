"use strict";

const axios = require("axios");
const { getStoreSettings, getApiKeys, DEFAULT_GEMINI_MODEL, callGeminiWithFallback } = require("../config/settings");
const { normalizeQuery, detectIntent, detectEntities, rankKnowledge, buildKnowledgeResponse } = require("../utils/nexbotEngine");
const nexbotCatalog = require("../utils/nexbotCatalog");
const { getResellerContext } = require("../services/resellerService");
const { hitungHargaReseller } = require("../utils/resellerPricing");
const aiProviderManager = require("../services/aiProviderManager");
const supabase = require("../config/db");

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
        await supabase.from("ai_gemini_logs").insert(payload);
    } catch (err) {
        console.warn("Gemini log insert warning:", err.message);
    }
}

// This is deliberately small. It makes the public assistant safe during a
// migration, but it is not a writable pseudo-database: admin changes must be
// persisted in Supabase or fail visibly.
const BUILTIN_KNOWLEDGE = [
    { id: "builtin-payment", title: "Metode Pembayaran", category: "Payment", keywords: "bayar pembayaran qris dana ovo gopay transfer bank va ipaymu", content: "Pembayaran NexShop diproses dengan aman menggunakan iPaymu sebagai payment gateway. Metode yang didukung meliputi QRIS, e-wallet (DANA, OVO, GoPay), Virtual Account, transfer bank, dan kartu kredit. Pilihan tersedia lengkap saat Checkout. Catatan: di sini DANA, OVO, dan GoPay berperan sebagai ALAT BAYAR. Terpisah dari itu, NexShop juga MENJUAL isi ulang saldo e-wallet tersebut sebagai produk di halaman Marketplace, jadi saldo DANA, OVO, GoPay, dan ShopeePay memang bisa dibeli di NexShop.", priority: 5, status: "active" },
    { id: "builtin-escrow", title: "Mekanisme Escrow", category: "Trust", keywords: "escrow aman penipuan tahan dana garansi uang kembali", content: "NexShop menyediakan mekanisme escrow untuk transaksi yang mendukungnya. Untuk transaksi yang menggunakan mekanisme escrow NexShop, dana ditahan sesuai alur escrow sampai kondisi transaksi terpenuhi.", priority: 5, status: "active" },
    { id: "builtin-legal", title: "Legalitas dan OSS", category: "Trust", keywords: "aman resmi legal penipu scam oss nib kbli terdaftar", content: "NexShop telah memiliki NIB dan terdaftar secara resmi melalui sistem OSS pemerintah. NIB NexShop adalah 1408260072494 dengan skala usaha mikro dan KBLI 60390. Untuk detail legalitas, kamu bisa melihat halaman Legalitas NexShop (nexshop.cloud/legalitas.html).", priority: 5, status: "active" },
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
    { id: "builtin-reseller", title: "Program Reseller NexShop", category: "Guide", keywords: "reseller jualan lagi harga khusus diskon reseller daftar reseller tier silver gold platinum mitra agen", content: "NexShop punya program reseller untuk yang mau menjual ulang produknya. Informasi dan pendaftarannya ada di halaman nexshop.cloud/reseller. Reseller yang pengajuannya sudah disetujui admin otomatis mendapat potongan harga di setiap produk, tanpa kode promo dan tanpa minimum transaksi. Besar potongannya mengikuti tingkatan reseller yang diberikan admin. Harga reseller dihitung di server dan langsung tampil saat akun reseller login.", priority: 5, status: "active" },
    { id: "builtin-berita", title: "NexShop News", category: "Guide", keywords: "berita artikel news portal berita nexshop news baca artikel", content: "NexShop punya portal berita sendiri bernama NexShop News di nexshop.cloud/berita, berisi artikel editorial seputar game dan dunia digital yang ditulis tim NexShop.", priority: 3, status: "active" },
    { id: "builtin-harga-cek", title: "Cara Mengetahui Harga Produk", category: "Pricing", keywords: "harga berapa biaya tarif daftar harga cek harga list harga", content: "Harga setiap produk NexShop bisa berubah sewaktu-waktu mengikuti harga penyedia. Harga terbaru selalu tampil di halaman produknya: menu Topup untuk topup game, dan halaman Marketplace untuk E-Wallet, pulsa, paket data, PLN, dan tagihan. Kamu juga bisa menanyakan harga suatu layanan langsung ke NexBot, dan angkanya diambil dari katalog yang sedang aktif.", priority: 4, status: "active" }
];

const QUICK_ACTIONS = {
    topup: "Cara Topup ML",
    promo: "Promo Hari Ini",
    order: "Status Pesanan Saya",
    faq: "FAQ NexShop"
};

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
    let rpcRows = [];
    try {
        const rpc = await supabase.rpc("search_nexbot_knowledge", { search_query: query.raw, result_limit: 80 });
        if (!rpc.error && Array.isArray(rpc.data)) rpcRows = rpc.data;
    } catch (_) { /* RPC opsional — katalog lengkap di bawah tetap jalan */ }

    let baseRows = [];
    const { data, error } = await supabase
        .from("knowledge_base")
        .select(knowledgeColumns())
        .eq("status", "active")
        .order("priority", { ascending: false })
        .limit(500);
    if (!error && data?.length) baseRows = data;

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
        filters,
        userId ? supabase.from("ai_user_memories").select("favorite_game,custom_preferences").eq("user_id", String(userId)).maybeSingle() : Promise.resolve({ data: null })
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
    const memory = await loadConversationMemory(sessionId, user?.id);
    const entities = [...new Set([...detectEntities(query), ...memoryEntities(query, memory)])];
    const knowledge = await loadKnowledge(query);
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
    try { await supabase.from("ai_conversations").insert(payload); } catch (_) { /* analytics/memory must never break chat */ }
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
    try { await supabase.from("ai_user_memories").upsert(payload, { onConflict: "user_id" }); } catch (_) { /* optional personalization */ }
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
    try { await supabase.from("ai_query_analytics").insert(payload); } catch (_) { /* analytics is non-blocking */ }
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

function stripStrayFallback(reply, hasKnowledge) {
    const trimmed = String(reply || "").trim();
    if (!hasKnowledge || trimmed === STRAY_FALLBACK_TEXT) return trimmed;
    if (trimmed.includes(STRAY_FALLBACK_TEXT)) {
        const cleaned = trimmed.split(STRAY_FALLBACK_TEXT).join("").replace(/\n{3,}/g, "\n\n").trim();
        return cleaned || trimmed;
    }
    return trimmed;
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
    const result = await retrieveKnowledge(message, sessionId, user);

    let reply = "";
    let source = "knowledge";
    const isContact = isContactQuery(message);
    const isBudgetQuery = !isContact && isBudgetQuestion(message);
    const isOrderQuery = !isContact && !isBudgetQuery && (result.intent === "Order" || /\b(NX[A-F0-9]{10,30}|TP[A-F0-9]{10,30})\b/i.test(message) || /status pesanan|lacak|pesanan saya/i.test(message));

    // Pertanyaan harga dijawab dari katalog hidup, bukan dari model bahasa
    // (harga berubah tiap admin sync katalog; model kecil gampang ngarang
    // nominal). handlePriceQuery balikin null kalau customer gak nyebut
    // layanan yang beneran ada di katalog -- jadi pertanyaan macam "berapa
    // lama prosesnya" gak kesangkut dan tetap lanjut ke alur knowledge.
    const priceReply = (!isContact && !isBudgetQuery && !isOrderQuery)
        ? await handlePriceQuery(message, user)
        : null;

    if (isContact) {
        reply = await handleContactQuery();
        source = "contact_info";
    } else if (isBudgetQuery) {
        reply = await handleBudgetQuery(message);
        source = "price_calculator";
    } else if (isOrderQuery) {
        reply = await handleOrderLookup(message, user);
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
            reply = unavailableReply();
            source = "handoff";
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

            const aiRes = await aiProviderManager.generateResponse({
                prompt: buildConversationPrompt(result.memory, message),
                systemPrompt,
                userId: user?.id,
                sessionId
            });

            if (aiRes.success && aiRes.reply) {
                reply = stripStrayFallback(aiRes.reply, result.selected.length > 0);
                source = aiRes.provider;
            } else {
                console.error("❌ AI Provider Manager failed for prompt:", message);
                console.error("   Error details:", aiRes.error);
                if (process.env.NODE_ENV !== "production") {
                    reply = `[Dev Mode AI Error]: ${aiRes.error || "Semua AI Provider gagal merespons"}`;
                } else {
                    reply = unavailableReply();
                }
                source = "handoff";
            }
        }
    }

    const knowledgeIds = result.selected.map((item) => String(item.id));
    await Promise.allSettled([
        saveConversation({ userId: user?.id, sessionId, role: "user", message, intent: result.intent, knowledgeIds }),
        saveConversation({ userId: user?.id, sessionId, role: "assistant", message: reply, intent: result.intent, knowledgeIds }),
        updateUserMemory(user, result.query, result.intent, result.entities),
        saveAnalytics({ ...result, source, failed: !result.selected.length && !["order_system", "price_calculator", "price_catalog", "contact_info"].includes(source) && !["gemini", "groq", "openrouter"].includes(source), user, sessionId })
    ]);
    return { reply, source, handoff: source === "handoff", intent: result.intent, entities: result.entities, knowledgeIds };
}

exports.chat = async (req, res) => {
    const message = safeMessage(req.body.message);
    if (!message) return res.status(400).json({ message: "Pesan tidak boleh kosong" });
    const sessionId = safeSessionId(req.body.session_id || req.headers["x-session-id"]);
    try {
        const result = await answer(message, sessionId, req.user || null);
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
        const { exec } = require('child_process');
        const path = require('path');
        const scriptPath = path.join(__dirname, '../scripts/ingest-website.js');
        
        exec(`node "${scriptPath}" web`, (error, stdout, stderr) => {
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
