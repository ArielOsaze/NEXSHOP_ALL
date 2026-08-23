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

console.log("=== 1. Chunk knowledge tersedia ===");
const ids = BUILTIN_KNOWLEDGE.map((k) => k.id);
console.log("   total chunk builtin:", BUILTIN_KNOWLEDGE.length);
for (const wajib of [
    "builtin-marketplace",
    "builtin-marketplace-cara",
    "builtin-pascabayar",
    "builtin-reseller",
    "builtin-berita",
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

console.log("\n==========================================");
if (gagal === 0) {
    console.log("ALL TESTS PASSED");
} else {
    console.log(`${gagal} TES GAGAL`);
    process.exitCode = 1;
}
