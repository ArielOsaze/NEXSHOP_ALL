// ===========================================================
// Verifikasi pengetahuan NexBot (tanpa memanggil AI provider).
//
// Dua hal yang dicek:
//
// 1. RETRIEVAL — untuk pertanyaan khas customer soal Marketplace/PPOB,
//    apakah ranker benar-benar MEMILIH chunk yang tepat? Kalau tidak ada
//    chunk terpilih, NexBot menjawab kalimat fallback "informasi belum
//    tersedia" -- persis gejala yang mau dihilangkan.
//
// 2. DETEKSI PERTANYAAN HARGA — apakah "harga pulsa Telkomsel berapa?"
//    dikenali sebagai pertanyaan harga, sementara "berapa lama prosesnya?"
//    TIDAK (kalau ikut kena, jawaban durasi bakal dibajak jadi daftar harga).
//
// Jalankan: node regtest/sim10_nexbot_knowledge.js
// ===========================================================

const path = require("path");

process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://dummy.supabase.co";
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "dummy_key";

const BE = path.join(__dirname, "..", "nexshop-backend");
const { normalizeQuery, detectIntent, detectEntities, rankKnowledge } = require(path.join(BE, "utils", "nexbotEngine"));
const nexbotCatalog = require(path.join(BE, "utils", "nexbotCatalog"));

// BUILTIN_KNOWLEDGE tidak diekspor, jadi dibaca dari source-nya. Ini
// disengaja: tesnya harus menguji daftar yang BENERAN dipakai controller,
// bukan salinan yang gampang basi.
const fs = require("fs");
const src = fs.readFileSync(path.join(BE, "controllers", "aiController.js"), "utf8");
const providerManagerSrc = fs.readFileSync(path.join(BE, "services", "aiProviderManager.js"), "utf8");
const frontendSrc = fs.readFileSync(path.join(__dirname, "..", "nexshop-frontend", "nexbot.js"), "utf8");
const indexSrc = fs.readFileSync(path.join(__dirname, "..", "nexshop-frontend", "index.html"), "utf8");
const blokAwal = src.indexOf("const BUILTIN_KNOWLEDGE = [");
const blokAkhir = src.indexOf("\n];", blokAwal);
const blok = src.slice(blokAwal + "const BUILTIN_KNOWLEDGE = ".length, blokAkhir + 2);
// eslint-disable-next-line no-eval
const BUILTIN_KNOWLEDGE = eval(blok);

let gagal = 0;

function cek(nama, aktual, harapan) {
    const ok = aktual === harapan;
    if (!ok) gagal++;
    console.log(`${ok ? "PASS" : "FAIL"} - ${nama}: expected ${harapan}, got ${aktual}`);
}

function pilih(pertanyaan) {
    const query = normalizeQuery(pertanyaan);
    const intent = detectIntent(query);
    const entities = detectEntities(query);
    const selected = rankKnowledge(BUILTIN_KNOWLEDGE, query, intent, entities);
    return { intent, selected: selected.map((s) => s.id) };
}

function cekRetrieval(pertanyaan, idHarusAda) {
    const { intent, selected } = pilih(pertanyaan);
    const ok = selected.includes(idHarusAda);
    if (!ok) gagal++;
    console.log(
        `${ok ? "PASS" : "FAIL"} - "${pertanyaan}"\n        intent=${intent} terpilih=[${selected.join(", ") || "KOSONG"}] harus ada: ${idHarusAda}`
    );
}

function cekRetrievalTeratas(pertanyaan, idHarusTeratas) {
    const { intent, selected } = pilih(pertanyaan);
    const aktual = selected[0] || "KOSONG";
    cek(`"${pertanyaan}" memilih fakta teratas yang tepat (intent=${intent})`, aktual, idHarusTeratas);
}

console.log("=== 1. Chunk knowledge tersedia ===");
const ids = BUILTIN_KNOWLEDGE.map((k) => k.id);
console.log("   total chunk builtin:", BUILTIN_KNOWLEDGE.length);
for (const wajib of [
    "builtin-marketplace",
    "builtin-marketplace-cara",
    "builtin-pascabayar",
    "builtin-reseller",
    "builtin-berita",
    "builtin-promo",
    "builtin-faq",
    "builtin-process",
    "builtin-account",
    "builtin-harga-cek"
]) {
    cek(`chunk ${wajib} ada`, ids.includes(wajib), true);
}

// Harga TIDAK BOLEH ditulis di knowledge statis -- itu bikin NexBot nyebut
// angka basi setelah admin ubah markup. Angka rupiah cuma boleh datang dari
// katalog hidup (handlePriceQuery / handleBudgetQuery).
console.log("\n=== 2. Tidak ada nominal harga yang di-hardcode di knowledge ===");
const adaNominal = BUILTIN_KNOWLEDGE.filter((k) => /rp\s?\d/i.test(String(k.content)));
cek("tidak ada chunk berisi nominal Rupiah", adaNominal.length, 0);
if (adaNominal.length) console.log("   pelanggar:", adaNominal.map((k) => k.id).join(", "));

console.log("\n=== 3. Retrieval pertanyaan Marketplace ===");
cekRetrieval("bisa isi saldo DANA gak di sini?", "builtin-marketplace");
cekRetrieval("apakah bisa bayar token listrik PLN?", "builtin-marketplace");
cekRetrieval("jual pulsa dan paket data gak?", "builtin-marketplace");
cekRetrieval("marketplace nexshop isinya apa aja?", "builtin-marketplace");
cekRetrieval("bagaimana cara beli di marketplace?", "builtin-marketplace-cara");
cekRetrieval("cara isi ulang e-wallet gimana?", "builtin-marketplace-cara");
cekRetrieval("cara cek tagihan pascabayar PDAM", "builtin-pascabayar");
cekRetrieval("apa itu program reseller nexshop?", "builtin-reseller");
cekRetrieval("saya mau jadi reseller caranya gimana", "builtin-reseller");
cekRetrieval("nexshop punya portal berita?", "builtin-berita");
cekRetrievalTeratas("bisa isi saldo DANA gak di sini?", "builtin-marketplace");

console.log("\n=== 4. Pertanyaan lama tidak boleh rusak ===");
cekRetrieval("apakah nexshop aman?", "builtin-trust");
cekRetrieval("nexshop legal gak?", "builtin-legal");
cekRetrieval("metode pembayaran apa saja?", "builtin-payment");
cekRetrieval("cara topup diamond mobile legends", "builtin-topup");
cekRetrieval("kebijakan refund gimana?", "builtin-refund");

console.log("\n=== 5. Deteksi pertanyaan harga ===");
const harusHarga = [
    "harga topup dana berapa?",
    "pulsa telkomsel berapaan?",
    "token PLN mulai dari berapa",
    "berapa harga voucher steam",
    "biaya isi saldo ovo"
];
for (const q of harusHarga) cek(`"${q}" dikenali sbg pertanyaan harga`, nexbotCatalog.isPriceQuestion(q), true);

const bukanHarga = [
    "berapa lama pesanan diproses?",
    "berapa hari refund cair?",
    "berapa jam prosesnya",
    "apakah nexshop aman?",
    "cara topup gimana"
];
for (const q of bukanHarga) cek(`"${q}" BUKAN pertanyaan harga`, nexbotCatalog.isPriceQuestion(q), false);

console.log("\n=== 6. Pencocokan istilah katalog (word-boundary) ===");
const n = nexbotCatalog.normalizeTerm;
cek("'ovo' cocok di 'isi saldo ovo'", nexbotCatalog.containsTerm(n("isi saldo ovo"), n("Ovo")), true);
cek("'ovo' TIDAK cocok di 'provider pembayaran'", nexbotCatalog.containsTerm(n("provider pembayaran"), n("Ovo")), false);
cek("'shopee pay' cocok di 'shopeepay'", nexbotCatalog.containsTerm(n("topup shopeepay"), n("shopeepay")), true);
cek("'pulsa telkomsel' cocok utuh", nexbotCatalog.containsTerm(n("harga pulsa telkomsel"), n("Pulsa Telkomsel")), true);
cek("term < 3 huruf ditolak", nexbotCatalog.containsTerm(n("beli ml"), n("ml")), false);

console.log("\n=== 7. NexShop Wallet & definisi Game Pass (dulu 0 chunk terpilih) ===");
cekRetrieval("apa itu nexshop wallet?", "builtin-wallet");
cekRetrieval("cara isi saldo nexshop wallet gimana?", "builtin-wallet");
cekRetrieval("gimana cara top up saldo wallet nexshop", "builtin-wallet");
cekRetrieval("apa itu game pass?", "builtin-gamepass");

console.log("\n=== 8. Seluruh pertanyaan template punya knowledge ===");
cekRetrieval("Apakah NexShop aman?", "builtin-trust");
cekRetrieval("Apakah NexShop legal?", "builtin-legal");
cekRetrieval("Pembayaran pakai apa?", "builtin-payment");
cekRetrieval("Ada escrow?", "builtin-escrow");
cekRetrieval("Cara membeli produk?", "builtin-produk");
cekRetrieval("Cara top up?", "builtin-topup");
cekRetrieval("Kebijakan refund?", "builtin-refund");
cekRetrieval("Promo Hari Ini", "builtin-promo");
cekRetrieval("FAQ NexShop", "builtin-faq");
cekRetrieval("berapa lama pesanan diproses?", "builtin-process");
cekRetrieval("kenapa saya tidak bisa login?", "builtin-account");

const templateMappings = {
    "apakah nexshop aman": "builtin-trust",
    "apakah nexshop legal": "builtin-legal",
    "pembayaran pakai apa": "builtin-payment",
    "ada escrow": "builtin-escrow",
    "cara membeli produk": "builtin-produk",
    "cara top up": "builtin-topup",
    "apa itu marketplace nexshop": "builtin-marketplace",
    "cara daftar reseller": "builtin-reseller-onboarding",
    "kebijakan refund": "builtin-refund",
    "promo hari ini": "builtin-promo",
    "faq nexshop": "builtin-faq"
};
for (const [query, id] of Object.entries(templateMappings)) {
    cek(`template "${query}" dipetakan langsung ke ${id}`, src.includes(`"${query}": "${id}"`), true);
}
cek("template dijawab tanpa menunggu provider AI", src.includes('source = "template_knowledge"'), true);
for (const topic of [
    "Apakah NexShop aman?", "Apakah NexShop legal?", "Pembayaran pakai apa?",
    "Ada escrow?", "Cara membeli produk?", "Cara top up?",
    "Apa itu Marketplace NexShop?", "Cara daftar reseller?",
    "Kebijakan refund?", "Hubungi Customer Service"
]) {
    cek(`template "${topic}" konsisten di widget pusat dan halaman utama`,
        frontendSrc.includes(`topic: "${topic}"`) && indexSrc.includes(`data-topic="${topic}"`), true);
}

console.log("\n=== 9. Fakta RAG tidak dibuang saat provider AI gagal ===");
cek("controller memiliki fallback renderer knowledge", src.includes("renderKnowledgeFallback(result.selected)"), true);
cek("query tanpa knowledge diteruskan ke fallback percakapan", src.includes("answerWithoutKnowledge(message, result, user, sessionId)"), true);
cek("penolakan persis dari model dibuang saat knowledge tersedia", src.includes('if (trimmed === STRAY_FALLBACK_TEXT) return ""'), true);
cek("variasi kalimat mohon maaf/knowledge dari model ikut disaring", src.includes("STRAY_FALLBACK_PATTERN") && src.includes(".replace(STRAY_FALLBACK_PATTERN, \"\")"), true);

console.log("\n=== 10. Jalur produksi selalu memiliki batas waktu dan fallback ===");
cek("frontend membatalkan request chat yang terlalu lama", frontendSrc.includes("NEXBOT_REQUEST_TIMEOUT_MS") && frontendSrc.includes("requestController.abort()"), true);
cek("backend membatasi keseluruhan request chat", src.includes("NEXBOT_CHAT_TIMEOUT_MS") && src.includes('source: "request_timeout"'), true);
cek("telemetry tidak menahan jawaban browser", src.includes("void Promise.allSettled(["), true);
cek("provider berikutnya dicoba setelah provider pertama gagal", providerManagerSrc.includes("Coba provider aktif berikutnya") && !providerManagerSrc.includes("Force Groq"), true);
cek("logging provider tidak menahan respons", providerManagerSrc.includes("void logProviderRequest({"), true);

console.log("\n==========================================");
if (gagal === 0) {
    console.log("ALL TESTS PASSED");
} else {
    console.log(`${gagal} TES GAGAL`);
    process.exitCode = 1;
}
