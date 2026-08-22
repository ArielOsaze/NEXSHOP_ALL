// ===========================================================
// Shared utility functions untuk topup — di-extract dari topupController
// supaya bisa dipakai barengan oleh controller DAN catalogService tanpa
// circular dependency. Logic-nya IDENTIK dengan yang sebelumnya inline
// di topupController.js.
// ===========================================================

// ===========================================================
// FILTER REGION — NexShop cuma jualan buat pasar Indonesia, tapi katalog
// TokoVoucher juga nyampur produk topup buat NEGARA LAIN dalam satu hasil
// pencarian yang sama (kategorinya "<Nama Negara> Topup", misal "Malaysia
// Topup", "Vietnam Topup", "Singapore Topup", "Philippines Topup",
// "Thailand Topup" -- BEDA sama "Topup Game" yang emang kategori game
// Indonesia, cuma kebetulan namanya mirip). Produk-produk luar negeri ini
// HARUS di-skip dari sync sama sekali -- gak boleh ikut kesimpen ke DB,
// apalagi ikut kena smart filter / aktivasi cerdas / markup manual /
// markup otomatis.
// ===========================================================
const FOREIGN_REGION_KATEGORI = new Set([
    "malaysia topup",
    "vietnam topup",
    "singapore topup",
    "philippines topup",
    "thailand topup"
]);

function isForeignRegion(kategori) {
    const k = String(kategori || "").trim().toLowerCase();
    if (!k) return false;
    if (FOREIGN_REGION_KATEGORI.has(k)) return true;
    // Jaga-jaga kalau TokoVoucher nambahin negara baru lagi ke depannya:
    // pola kategorinya konsisten "<Nama Negara> Topup" (kata "Topup" di
    // AKHIR). "Topup Game" sengaja DIKECUALIIN krn urutan katanya kebalik
    // (kata "Topup" di DEPAN) dan itu emang kategori Indonesia.
    return /\btopup$/i.test(k) && k !== "topup game";
}

// ===========================================================
// FILTER REGION LEWAT KODE PRODUK -- sebagian game (MLBB, Valorant, dst)
// nyimpen SEMUA region jadi 1 kategori yang sama ("Topup Game"), region-nya
// cuma kebedain lewat SUFFIX di kode_produk (mis. "MLBB1163" = Indonesia,
// "MLBBPH1163" = Philippines, "MLBBGLO..." = Global). isForeignRegion() di
// atas gak bisa nangkep ini krn kategorinya sama persis kayak produk Indo.
//
// PENTING: JANGAN filter pakai cek substring "PH" doang di kode_produk --
// banyak kode produk LAIN yang kebetulan ngandung "PH" tapi BUKAN produk
// Philippines, misal "KPHAGO5" (Hago) atau "DAPH35GB3H" (paket data Axis).
// Makanya di sini kita whitelist per PREFIX GAME yang emang udah kekonfirmasi
// punya varian region, baru dicek suffix-nya pas abis prefix itu.
// ===========================================================
const FOREIGN_REGION_CODE_PATTERNS = [
    // MLBB (Mobile Legends): base "MLBB1163"/"KPMLBB1163" = Indonesia.
    // "MLBBPH...", "MLBBPHK...", "MLBBGLO...", "MLBBND...", "MLBBBR..." = luar.
    /^(KP)?MLBB(PHK|PH|GLO|ND|BR)\d*[A-Z0-9]*$/i,
    // Valorant: base "VALO1000" = Indonesia. "VALOPH...", "VALOMY...",
    // "VALOTH...", "VALOSG..." = luar.
    /^VALO(PH|MY|TH|SG)\d+$/i
];

function isForeignRegionCode(kodeProduk) {
    const kode = String(kodeProduk || "").trim();
    if (!kode) return false;
    return FOREIGN_REGION_CODE_PATTERNS.some((re) => re.test(kode));
}

// Gabungan: true kalau produk luar Indonesia baik lewat kategori MAUPUN
// lewat kode_produk. Pakai ini (bukan isForeignRegion doang) di semua
// tempat yang nge-filter produk region luar.
function isForeignProduct(kategori, kodeProduk, namaProduk = "") {
    const isForeignName = /\((SG|MY|VN|TH|PH|GLOBAL)\)|\b(malaysia|vietnam|thailand|singapore|philippines|global)\b/i.test(namaProduk);
    return isForeignRegion(kategori) || isForeignRegionCode(kodeProduk) || isForeignName;
}

// ===========================================================
// MARKUP — hitung harga jual "wajar" dari harga modal
// ===========================================================
const MARKUP_TIERS = [
    { max: 30000, percent: 2 },
    { max: 1000000, percent: 5 },
    { max: Infinity, percent: 4.5 }
];
// Batas atas ABSOLUT (rupiah) buat markup, KHUSUS dipakai kalau hasil
// persen-nya lebih gede dari ini — supaya modal yang beneran gede (topup
// jutaan) gak ditambahin untung yang ngebubung ikut-ikutan gede. null =
// gak ada batas (skema % doang, perilaku lama).
const MARKUP_CAP_ABSOLUT = 100000;
const AUTO_MARKUP_ROUND = 0; // 0 = harga jual gak dibulatkan ke kelipatan apa pun, cuma dibulatkan ke rupiah terdekat

// Bulatkan ke ATAS ke kelipatan `round` terdekat. Pakai epsilon kecil
// sebelum Math.ceil supaya noise floating-point JS (mis. 5000*1.2 yang
// harusnya persis 6000 tapi kekomputasi 6000.000000000001) gak bikin
// harga kebulet naik satu kelipatan penuh secara gak sengaja.
function bulatkanKeAtas(nilai, round) {
    if (!round || round <= 0) return Math.round(nilai);
    const EPS = 1e-6;
    return Math.ceil(nilai / round - EPS) * round;
}

function hitungMarkupWajar(hargaBeli) {
    const modal = Number(hargaBeli) || 0;
    const tier = MARKUP_TIERS.find((t) => modal <= t.max) || MARKUP_TIERS[MARKUP_TIERS.length - 1];
    const jualPersen = modal * (1 + tier.percent / 100);
    const jual = MARKUP_CAP_ABSOLUT !== null ? Math.min(jualPersen, modal + MARKUP_CAP_ABSOLUT) : jualPersen;
    return bulatkanKeAtas(jual, AUTO_MARKUP_ROUND);
}

// ===========================================================
// KLASIFIKASI SECTION -- kategori NexShop (nexshop_category_name di
// topup_category_map, disimpan sebagai topup_products.kategori) dipisah
// ke 2 "etalase" publik yang GAK BOLEH nyampur:
//   - Topup Diamond (game)          -> cuma kategori game
//   - One Stop Solution/Marketplace -> sisanya (E-Wallet, PLN, Pulsa,
//                                       Paket Data, Tagihan, Hiburan, dll)
// SEBELUM ini ditambahin, endpoint publik getProducts() (feed Topup
// Diamond) dan getPublicCatalog() (feed Marketplace) sama-sama narik
// SEMUA produk aktif tanpa peduli kategori -- jadi produk yang admin
// aktifin di kategori non-game (misal DANA/E-Wallet) malah ikut numpuk
// muncul sebagai "game card" di grid Topup Diamond, bukan di Marketplace.
// ===========================================================
const TOPUP_GAME_CATEGORIES = new Set([
    "gaming"
]);

function isTopupGameCategory(nexshopCategoryName) {
    return TOPUP_GAME_CATEGORIES.has(String(nexshopCategoryName || "").trim().toLowerCase());
}

// ===========================================================
// RESOLUSI KATEGORI — SATU sumber kebenaran buat "produk ini masuk
// kategori NexShop yang mana". Sebelumnya logika ini di-copy-paste di 3
// tempat (getCatalogSummary, getPublicCatalog, dan renderProductTable di
// frontend). Yang di frontend nge-baca `categoryMap` yang GAK PERNAH
// di-load, jadi SEMUA produk jatuh ke "Lainnya" -- itu sebabnya tabel
// produk di dashboard selalu kosong pas kategori dipilih.
//
// Prioritas: override manual admin -> map by nama kategori TokoVoucher ->
// map by kategori yang kesimpen -> "Lainnya".
// categoryMap boleh Map ataupun object biasa.
// ===========================================================
function resolveNexshopCategory(product, categoryMap) {
    const lookup = (key) => {
        if (!key) return undefined;
        if (categoryMap instanceof Map) return categoryMap.get(key);
        return categoryMap ? categoryMap[key] : undefined;
    };

    if (product.manual_category_override) return product.kategori || "Lainnya";
    return lookup(product.source_category_name) || lookup(product.kategori) || "Lainnya";
}

// Identitas operator/game yang STABIL. Produk lama hasil sync jadul gak
// punya source_operator_id, jadi dikasih id turunan dari namanya supaya
// tetap bisa dikelompokkan (dan tetap kebedain dari operator ber-id).
function resolveOperator(product) {
    const name = product.source_operator_name || product.kategori || "Unknown";
    const id = product.source_operator_id ? String(product.source_operator_id) : "LEGACY_OP_" + name;
    return { id, name };
}

module.exports = {
    FOREIGN_REGION_KATEGORI,
    FOREIGN_REGION_CODE_PATTERNS,
    isForeignRegion,
    isForeignRegionCode,
    isForeignProduct,
    MARKUP_TIERS,
    MARKUP_CAP_ABSOLUT,
    AUTO_MARKUP_ROUND,
    bulatkanKeAtas,
    hitungMarkupWajar,
    TOPUP_GAME_CATEGORIES,
    isTopupGameCategory,
    resolveNexshopCategory,
    resolveOperator
};
