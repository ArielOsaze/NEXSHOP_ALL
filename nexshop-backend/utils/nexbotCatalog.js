// ===========================================================
// KATALOG HIDUP BUAT NEXBOT
//
// Pertanyaan soal HARGA tidak boleh dijawab lewat model bahasa. Harga di
// NexShop berubah tiap kali admin sync katalog atau ubah markup, sementara
// knowledge base itu teks statis -- kalau harga ditaruh di sana, NexBot
// bakal pede nyebut angka yang sudah basi. Model kecil juga gampang ngarang
// nominal. Prinsip yang sama sudah dipakai handleBudgetQuery di
// aiController; modul ini memperluasnya ke SELURUH katalog marketplace
// (E-Wallet, Pulsa, Paket Data, PLN, Tagihan, Voucher Game, dst), bukan
// cuma tiga game.
//
// Cara kerjanya: daftar kategori & operator yang BENERAN aktif diambil dari
// tabel topup_products (sumber yang sama dengan halaman Marketplace), lalu
// dicocokkan ke kalimat customer. Kalau tidak ada yang cocok, modul ini
// bilang "tidak tahu" dan pertanyaannya diteruskan ke alur knowledge biasa.
// ===========================================================

const supabase = require("../config/db");
const { isCheckerUtilityProduct } = require("./topupHelpers");

// Katalog di-cache supaya tiap chat tidak query tabel besar. 5 menit cukup
// pendek untuk mengikuti perubahan admin, cukup panjang untuk melindungi DB
// dari percakapan yang ramai.
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache = { data: null, ts: 0 };

// Alias yang tidak bisa ditebak dari nama operator di database.
// Kuncinya bentuk yang diketik customer, nilainya penggalan nama yang
// dipakai buat query (dicocokkan pakai ilike).
const CATALOG_ALIASES = [
    { terms: ["shopeepay", "spay"], target: "Shopee Pay", type: "operator" },
    { terms: ["gopay", "go pay"], target: "Gopay", type: "operator" },
    { terms: ["linkaja", "link aja"], target: "LinkAja", type: "operator" },
    { terms: ["isaku", "i saku"], target: "i.Saku", type: "operator" },
    { terms: ["astra pay"], target: "AstraPay", type: "operator" },
    { terms: ["token listrik", "listrik", "pln"], target: "PLN", type: "kategori" },
    { terms: ["e wallet", "ewallet", "dompet digital", "saldo"], target: "E-Wallet", type: "kategori" },
    { terms: ["kuota", "paket internet", "internet"], target: "Paket Data", type: "kategori" },
    { terms: ["etoll", "e toll", "kartu tol"], target: "E-Toll", type: "kategori" },
    { terms: ["ppob", "bayar tagihan"], target: "Tagihan", type: "kategori" },
    { terms: ["voucher game"], target: "Voucher Game", type: "kategori" }
];

// Kata yang bikin "berapa" BUKAN pertanyaan harga.
const NOT_PRICE_PATTERN = /\bberapa\s+(lama|hari|jam|menit|detik|kali|banyak\s+waktu)\b/;
const PRICE_PATTERN = /\b(harga|harganya|biaya|tarif|nominal|berapaan|price)\b|\bberapa\b|\bmulai\s+dari\b/;

function isPriceQuestion(rawMessage) {
    const text = String(rawMessage || "").toLowerCase();
    if (NOT_PRICE_PATTERN.test(text)) return false;
    return PRICE_PATTERN.test(text);
}

// Bandingkan pakai bentuk yang sudah "dibersihkan": huruf/angka saja,
// dipisah satu spasi. Dengan begini "Shopee Pay", "shopeepay", dan
// "SHOPEE-PAY" jadi bentuk yang bisa dibandingkan.
function normalizeTerm(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

// Cocokkan sebagai KATA UTUH, bukan substring. Tanpa ini "ovo" ikut
// kena di kata "provider" dan "ml" nyangkut di "html".
function containsTerm(haystackNorm, termNorm) {
    if (!termNorm || termNorm.length < 3) return false;
    return new RegExp("(^| )" + termNorm.replace(/ /g, " +") + "( |$)").test(haystackNorm);
}

async function loadCatalogIndex({ fresh = false } = {}) {
    const now = Date.now();
    if (!fresh && cache.data && now - cache.ts < CACHE_TTL_MS) return cache.data;

    const { data, error } = await supabase
        .from("topup_products")
        .select("kategori, source_operator_name")
        .eq("is_active", true)
        .limit(5000);

    if (error) {
        // Katalog gagal dimuat bukan alasan buat menjatuhkan chat --
        // pertanyaannya tinggal jatuh ke alur knowledge biasa.
        console.log("[nexbot-catalog] gagal memuat katalog:", error.message);
        return { kategori: [], operator: [], error: true };
    }

    const kategori = new Set();
    const operator = new Set();
    for (const row of data || []) {
        if (row.kategori) kategori.add(String(row.kategori).trim());
        if (row.source_operator_name) operator.add(String(row.source_operator_name).trim());
    }

    const index = {
        kategori: [...kategori].filter(Boolean),
        operator: [...operator].filter(Boolean),
        error: false
    };
    cache = { data: index, ts: now };
    return index;
}

// Cari kategori/operator yang disebut customer. Yang dipilih adalah
// kecocokan TERPANJANG: "pulsa telkomsel" harus menang atas "pulsa" dan
// atas "telkomsel", kalau tidak jawabannya jadi terlalu umum.
async function matchCatalogTarget(rawMessage) {
    const messageNorm = normalizeTerm(rawMessage);
    if (!messageNorm) return null;

    const index = await loadCatalogIndex();
    const kandidat = [];

    for (const name of index.operator) {
        kandidat.push({ type: "operator", value: name, term: normalizeTerm(name) });
    }
    for (const name of index.kategori) {
        kandidat.push({ type: "kategori", value: name, term: normalizeTerm(name) });
    }
    for (const alias of CATALOG_ALIASES) {
        for (const t of alias.terms) {
            kandidat.push({ type: alias.type, value: alias.target, term: normalizeTerm(t) });
        }
    }

    let terbaik = null;
    for (const c of kandidat) {
        if (!containsTerm(messageNorm, c.term)) continue;
        if (!terbaik || c.term.length > terbaik.term.length) terbaik = c;
    }
    return terbaik;
}

function rupiah(value) {
    return "Rp" + Number(value || 0).toLocaleString("id-ID");
}

// Ambil daftar produk termurah untuk satu target. Sengaja pakai ilike biar
// "Pulsa" cocok ke "Pulsa Telkomsel" dst.
//
// SKU utilitas "Cek ..." dibuang pakai isCheckerUtilityProduct -- helper
// yang SAMA dengan yang dipakai getPublicCatalog buat etalase Marketplace.
// Wajib satu sumber: kalau NexBot pakai aturan sendiri, angka "mulai dari"
// di chat bisa beda dari yang tampil di halaman, dan itu justru bikin
// customer curiga. SKU ini API verifikasi nomor seharga Rp4-Rp10, bukan
// barang yang bisa dibeli.
//
// Diambil lebih banyak dari `limit` lalu dipangkas SESUDAH difilter --
// kalau enggak, satu target yang baris termurahnya kebetulan checker semua
// bisa balik kosong padahal produknya ada.
const FETCH_MULTIPLIER = 5;

async function fetchProductsForTarget(target, { limit = 6 } = {}) {
    const kolom = target.type === "operator" ? "source_operator_name" : "kategori";
    const { data, error } = await supabase
        .from("topup_products")
        .select("nama, harga_jual, harga_beli, kategori, source_operator_name")
        .eq("is_active", true)
        .ilike(kolom, `%${target.value}%`)
        .order("harga_jual", { ascending: true })
        .limit(Math.max(limit * FETCH_MULTIPLIER, 40));

    if (error) return { rows: [], total: 0, error: true };

    const sellable = (data || []).filter((row) => !isCheckerUtilityProduct(row.nama));

    // `total` dihitung dari baris yang sudah difilter juga, supaya kalimat
    // "masih ada N pilihan lain" gak ngitung SKU yang gak bisa dibeli.
    const { count } = await supabase
        .from("topup_products")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true)
        .ilike(kolom, `%${target.value}%`);

    const totalKotor = count || (data || []).length;
    const terbuang = (data || []).length - sellable.length;

    return {
        rows: sellable.slice(0, limit),
        total: Math.max(totalKotor - terbuang, sellable.length),
        error: false
    };
}

module.exports = {
    isPriceQuestion,
    matchCatalogTarget,
    fetchProductsForTarget,
    loadCatalogIndex,
    normalizeTerm,
    containsTerm,
    rupiah,
    CATALOG_ALIASES
};
