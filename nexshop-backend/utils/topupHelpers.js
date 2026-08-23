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

// ===========================================================
// MARKUP KHUSUS E-WALLET — skema di atas (persen dari modal) TIDAK cocok
// dipakai buat E-Wallet. Nominal top up e-wallet bisa nyampe ratusan
// ribu/jutaan, tapi di dunia nyata biaya admin top up e-wallet di
// marketplace besar SELALU flat/nyaris-flat -- gak pernah ikut naik
// proporsional sama nominalnya (top up Rp1jt gak mungkin kena admin
// Rp50rb kayak hasil skema persen di atas). Pembanding per Agustus 2026:
// admin GoPay/DANA sekitar Rp1.000, OVO sekitar Rp1.500, ShopeePay
// sekitar Rp2.500, top up lewat Alfamart/Indomaret flat Rp2.500 berapa
// pun nominalnya.
//
// Makanya E-Wallet dikasih skema SENDIRI: FLAT per operator (beda-beda,
// nyontoin kenyataan tiap e-wallet emang beda biaya adminnya -- bukan
// disamain rata kayak skema persen di atas), dengan fallback tertier
// (naik sedikit tiap kelipatan modal, BUKAN persen) buat operator yang
// belum ke-daftar, dan HARD CAP di EWALLET_ADMIN_MAX supaya berapa pun
// hasil hitungannya gak akan pernah lebih dari itu.
const EWALLET_ADMIN_MIN = 1000;
const EWALLET_ADMIN_MAX = 5000;

// Admin fee flat per operator e-wallet. Sengaja beda-beda per operator
// (bukan satu angka buat semua) -- kalau mau nyesuain, ubah di sini,
// tapi tetap keclamp ke EWALLET_ADMIN_MIN..EWALLET_ADMIN_MAX di
// hitungAdminEwallet() di bawah, jadi gak akan pernah "ngaco" gara-gara
// typo angka gede di sini.
const EWALLET_ADMIN_PER_OPERATOR = {
    dana: 1000,
    gopay: 1000,
    ovo: 1500,
    shopeepay: 2500,
    linkaja: 2000
};

// Fallback buat operator e-wallet yang belum ke-daftar di atas: admin
// naik Rp1.000 tiap kelipatan modal Rp100.000 (BUKAN persen dari modal),
// tetap diclamp ke MIN..MAX di bawah.
const EWALLET_ADMIN_FALLBACK_STEP = 100000;
const EWALLET_ADMIN_FALLBACK_PER_STEP = 1000;

function normalisasiNamaOperator(nama) {
    return String(nama || "").trim().toLowerCase().replace(/[^a-z]/g, "");
}

function hitungAdminEwallet(hargaBeli, namaOperator) {
    const modal = Number(hargaBeli) || 0;
    if (modal <= 0) return 0;
    const op = normalisasiNamaOperator(namaOperator);
    let admin = EWALLET_ADMIN_PER_OPERATOR[op];
    if (admin === undefined) {
        const steps = Math.max(1, Math.ceil(modal / EWALLET_ADMIN_FALLBACK_STEP));
        admin = steps * EWALLET_ADMIN_FALLBACK_PER_STEP;
    }
    return Math.min(Math.max(admin, EWALLET_ADMIN_MIN), EWALLET_ADMIN_MAX);
}

// Pengenalan kategori E-Wallet lewat pola (bukan cuma samain persis
// "e-wallet") -- soalnya penamaan kategori sumbernya bisa beda-beda
// tergantung mapping admin (kadang "E-Wallet", kadang ke-mapping
// "E-Money"), padahal dua-duanya produk yang sama: top up saldo dompet
// digital.
const POLA_KATEGORI_EWALLET = /e[-\s]?wallet|e[-\s]?money|dompet\s*digital/i;

function isEwalletCategoryName(nama) {
    return POLA_KATEGORI_EWALLET.test(String(nama || "").trim());
}

// `kategori` & `namaOperator` OPSIONAL -- kalau kosong (caller lama yang
// belum di-update), fungsi ini tetap jalan pakai skema persen umum di
// atas, PERSIS kayak sebelumnya (gak ada perilaku yang tiba-tiba
// berubah diam-diam kalau parameternya kelewat).
function hitungMarkupWajar(hargaBeli, kategori, namaOperator) {
    const modal = Number(hargaBeli) || 0;
    if (isEwalletCategoryName(kategori)) {
        return bulatkanKeAtas(modal + hitungAdminEwallet(modal, namaOperator), AUTO_MARKUP_ROUND);
    }
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

// Pengenalan produk game yang LEBIH LUAS dari isTopupGameCategory.
//
// Kenapa perlu: TOPUP_GAME_CATEGORIES cuma tahu satu nama ("gaming"),
// padahal nama kategori yang beneran nyampe ke produk beda-beda tergantung
// mapping admin dan fallback DEFAULT_CATEGORY_MAP di catalogService
// ("Topup Game", "Games", "Voucher Game"). Akibatnya produk game yang
// kategorinya kebaca sebagai "Topup Game"/"Voucher Game" LOLOS dari filter
// dan nyasar ke etalase Marketplace, padahal Marketplace khusus produk
// non-game (PPOB: pulsa, data, e-wallet, PLN, tagihan).
const POLA_KATEGORI_GAME = /topup\s*game|^gaming$|^games?$|voucher\s*game|game\s*voucher/i;

function isGameCategoryName(nama) {
    const n = String(nama || "").trim().toLowerCase();
    if (!n) return false;
    return isTopupGameCategory(n) || POLA_KATEGORI_GAME.test(n);
}

// Dicek dari kategori tampilan (hasil mapping), kategori tersimpan, DAN
// nama kategori asli TokoVoucher -- cukup satu yang kebaca game, produknya
// dianggap game.
function isGameProduct(product, displayCategory) {
    if (!product) return isGameCategoryName(displayCategory);
    return (
        isGameCategoryName(displayCategory) ||
        isGameCategoryName(product.kategori) ||
        isGameCategoryName(product.source_category_name)
    );
}

// ===========================================================
// FILTER PRODUK "CEK AKUN" (UTILITY, BUKAN PRODUK JUALAN) -- katalog
// TokoVoucher nyampur SKU utilitas kayak "Cek Nama Akun Dana" (Rp4),
// "Cek ID Free Fire", "Cek Nickname Mobile Legends" di hasil pencarian
// yang sama kayak produk jualan beneran. SKU ini sebenarnya API
// verifikasi akun (buat validasi nomor/ID tujuan sebelum checkout),
// BUKAN barang yang boleh dibeli sendiri -- tapi kalau ke-aktifin
// (manual atau lewat bulk-activate), dia nongol persis kayak produk
// asli di etalase publik.
//
// Polanya konsisten: nama produk DIAWALI kata "Cek" diikuti salah satu
// kata utilitas di bawah. Sengaja gak pakai substring match (bukan
// `nama.includes("cek")`) supaya produk jualan beneran yang kebetulan
// ngandung kata "cek" di tengah nama gak ikut kefilter.
//
// "status", "kartu", dan "hutang" ditambahkan belakangan. SKU macam
// "Cek Status Voucher Data XL" (Rp4), "Cek Kartu Perdana Tri" (Rp4), dan
// "Cek Hutang Pulsa Telkomsel" (Rp10) lolos dari pola lama lalu nongol di
// etalase Marketplace. Karena kartu operator nampilin harga TERMURAH, satu
// SKU Rp4 bikin SELURUH kategori kelihatan "Mulai dari Rp4" -- harga yang
// gak pernah bisa beneran dibeli customer. Efek yang sama juga bikin
// NexBot nyebutin nominal itu waktu ditanya harga.
//
// "tagihan" SENGAJA TIDAK dimasukkan: cek tagihan pascabayar itu alur yang
// beneran dipakai customer, bukan SKU utilitas internal.
// ===========================================================
const CHECKER_UTILITY_NAME_PATTERN = /^cek\s+(nama|id|nickname|akun|nomor|saldo|status|kartu|hutang)\b/i;

function isCheckerUtilityProduct(nama) {
    const n = String(nama || "").trim();
    if (!n) return false;
    return CHECKER_UTILITY_NAME_PATTERN.test(n);
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

// ===========================================================
// PRODUK PASCABAYAR — satu-satunya kategori TokoVoucher yang punya endpoint
// "cek tagihan" (inquiry). Kategori Pascabayar di TokoVoucher id-nya 13,
// tapi id itu bisa aja berubah/beda per akun, makanya nama kategori asli
// ikut dicek sebagai cadangan. SENGAJA gak ngecek kategori NexShop
// ("Tagihan"), karena kategori itu juga nampung produk TV prabayar yang
// GAK bisa di-inquiry.
// ===========================================================
const PASCABAYAR_CATEGORY_ID = "13";

function isPascabayarProduct(product) {
    if (!product) return false;
    const categoryId = product.source_category_id;
    if (categoryId !== null && categoryId !== undefined && String(categoryId).trim() === PASCABAYAR_CATEGORY_ID) return true;
    return /pascabayar/i.test(String(product.source_category_name || ""));
}

// Identitas operator/game yang STABIL. Produk lama hasil sync jadul gak
// punya source_operator_id, jadi dikasih id turunan dari namanya supaya
// tetap bisa dikelompokkan (dan tetap kebedain dari operator ber-id).
function resolveOperator(product) {
    const name = product.source_operator_name || product.kategori || "Unknown";
    const id = product.source_operator_id ? String(product.source_operator_id) : "LEGACY_OP_" + name;
    return { id, name };
}

// ===========================================================
// TAMPILAN FIELD "TUJUAN" PER KATEGORI — SATU sumber kebenaran buat label +
// placeholder yang ditampilin di form checkout Marketplace, DAN label yang
// dipakai lagi pas nampilin hasil di "Cek Status Transaksi" / notif WA
// sukses. Sebelumnya cuma ada 1 pembagian biner (game vs bukan-game), jadi
// SEMUA produk non-game (Pulsa, PLN, E-Wallet, Tagihan, dst) kepukul rata
// minta "Nomor Handphone / Tujuan" -- padahal PLN misalnya butuhnya ID
// Pelanggan, bukan nomor HP.
//
// PENTING: marketplace.html PUNYA SALINAN mapping yang setara di JS
// browser (gak bisa import module Node langsung ke <script> biasa) --
// kalau nambah/ubah kategori di sini, samain juga di sana biar konsisten.
// ===========================================================
function getTargetFieldMeta(displayCategory, isPascabayar) {
    const kat = String(displayCategory || "").trim().toLowerCase();

    if (kat === "pln") {
        return isPascabayar
            ? { formLabel: "ID Pelanggan / No Meter PLN", placeholder: "Masukkan ID Pelanggan PLN", resultLabel: "ID Pelanggan" }
            : { formLabel: "ID Pelanggan PLN", placeholder: "Contoh: 520551398488", resultLabel: "ID Pelanggan" };
    }
    if (kat === "tagihan") {
        return { formLabel: "ID Pelanggan / Nomor Tujuan", placeholder: "Masukkan ID Pelanggan", resultLabel: "ID Pelanggan" };
    }
    if (kat === "pulsa" || kat === "paket data") {
        return { formLabel: "Nomor HP Tujuan", placeholder: "08xxxxxxxxxx", resultLabel: "Nomor HP Tujuan" };
    }
    if (kat === "e-wallet") {
        return { formLabel: "Nomor HP / Akun E-Wallet Tujuan", placeholder: "08xxxxxxxxxx", resultLabel: "Nomor Tujuan" };
    }
    if (kat === "voucher game" || kat === "gaming") {
        return { formLabel: "Player ID / User ID", placeholder: "Masukkan Player ID", resultLabel: "Player ID / User ID" };
    }
    if (kat === "hiburan") {
        return { formLabel: "Nomor HP / Akun Tujuan", placeholder: "Masukkan nomor HP / akun tujuan", resultLabel: "Akun Tujuan" };
    }
    return { formLabel: "Nomor / ID Tujuan", placeholder: "Masukkan nomor atau ID tujuan", resultLabel: "Nomor / ID Tujuan" };
}

// ===========================================================
// TOKEN PLN PRABAYAR — TokoVoucher balikin field `sn` PLN Prabayar sebagai
// SATU string gabungan: "<20 digit no. token>/<Nama Pelanggan> <Daya
// terpasang>/<Golongan Tarif>/<Estimasi kWh>", contoh:
//   "5595-5001-5488-1855-2757/BAMBANG DALYONO 5/R1M/900VA/13.5kwh"
// Dipisah cuma di garis miring PERTAMA -- sisanya (keterangan pelanggan +
// daya + tarif + kwh, yang juga makai "/" sebagai pemisah internal) tetap
// utuh apa adanya, bukan ikut kepotong.
// ===========================================================
function parsePlnTokenSn(serialNumber) {
    const raw = String(serialNumber || "").trim();
    if (!raw) return null;
    const idx = raw.indexOf("/");
    if (idx === -1) return { token: raw, keterangan: "" };
    return { token: raw.slice(0, idx).trim(), keterangan: raw.slice(idx + 1).trim() };
}

// ===========================================================
// INSTRUKSI KODE/SN PER KATEGORI — dipakai di "Cek Status Transaksi" DAN di
// notifikasi WA sukses, supaya pembeli awam yang gak ngerti PPOB tahu kode
// yang dia terima itu buat apa (khususnya token listrik PLN 20 digit yang
// harus dia MASUKIN SENDIRI ke meteran -- tanpa keterangan ini banyak yang
// gak sadar itu bukan cuma nomor referensi).
// ===========================================================
function getSerialInstruction(displayCategory, isPascabayar) {
    const kat = String(displayCategory || "").trim().toLowerCase();
    if (kat === "pln" && !isPascabayar) {
        return "Masukkan 20 digit No. Token di atas ke meteran listrik prabayar Anda menggunakan tombol angka pada meteran, lalu tekan \"Enter\"/\"Accept\". Token akan otomatis menambah sisa kWh Anda.";
    }
    if (kat === "voucher game" || kat === "gaming") {
        return "Ini adalah kode voucher/serial number Anda. Redeem kode ini sesuai petunjuk pada game atau platform terkait.";
    }
    if (kat === "hiburan") {
        return "Ini adalah kode voucher Anda. Gunakan kode ini sesuai petunjuk redeem pada aplikasi/layanan terkait.";
    }
    if (kat === "tagihan") {
        return "Ini adalah nomor referensi pembayaran Anda. Simpan sebagai bukti pembayaran tagihan.";
    }
    return "Simpan kode/SN ini sebagai bukti transaksi Anda.";
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
    EWALLET_ADMIN_MIN,
    EWALLET_ADMIN_MAX,
    EWALLET_ADMIN_PER_OPERATOR,
    EWALLET_ADMIN_FALLBACK_STEP,
    EWALLET_ADMIN_FALLBACK_PER_STEP,
    hitungAdminEwallet,
    POLA_KATEGORI_EWALLET,
    isEwalletCategoryName,
    TOPUP_GAME_CATEGORIES,
    isTopupGameCategory,
    POLA_KATEGORI_GAME,
    isGameCategoryName,
    isGameProduct,
    CHECKER_UTILITY_NAME_PATTERN,
    isCheckerUtilityProduct,
    PASCABAYAR_CATEGORY_ID,
    isPascabayarProduct,
    resolveNexshopCategory,
    resolveOperator,
    getTargetFieldMeta,
    parsePlnTokenSn,
    getSerialInstruction
};
