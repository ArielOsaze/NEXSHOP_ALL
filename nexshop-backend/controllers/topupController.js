const supabase = require("../config/db");
const crypto = require("crypto");
const tokovoucher = require("../config/tokovoucher");
const catalogService = require("../services/catalogService");
const { createRedirectPayment, checkTransactionStatus, createDirectPayment, isDirectPaymentMethod } = require("../config/ipaymu");

const { checkNickname } = require("../config/apigames");
const { notify } = require("../config/notify");
const { sendUserWhatsApp } = require("../services/userWhatsAppService");
const { sendTopupInvoiceEmail } = require("../config/mailer");
const { sendTelegramNotification } = require("../config/telegram");
const { sendWhatsAppNotification } = require("../config/whatsapp");
const { validatePromoCode, incrementUsage } = require("./promoCodeController");
const { buildDiscountedIpaymuItems } = require("../utils/promoDiscountSplit");
const {
    isForeignRegion,
    isForeignRegionCode,
    isForeignProduct,
    FOREIGN_REGION_KATEGORI,
    FOREIGN_REGION_CODE_PATTERNS,
    hitungMarkupWajar,
    bulatkanKeAtas,
    MARKUP_TIERS,
    MARKUP_CAP_ABSOLUT,
    AUTO_MARKUP_ROUND,
    isTopupGameCategory,
    isGameProduct,
    isCheckerUtilityProduct,
    isPascabayarProduct,
    resolveNexshopCategory,
    resolveOperator,
    getTargetFieldMeta,
    parsePlnTokenSn,
    getSerialInstruction
} = require("../utils/topupHelpers");
const { fetchAllRows } = require("../utils/supabasePaginate");
const { getResellerContext } = require("../services/resellerService");
const { hitungHargaReseller } = require("../utils/resellerPricing");

const IPAYMU_PAYMENT_METHODS = Object.freeze({
    qris: "qris",
    va: "va",
    banktransfer: "banktransfer",
    card: "cc"
});

const FRONTEND_URL = (process.env.FRONTEND_URL || "").replace(/\/$/, "");
const BACKEND_URL = (process.env.BACKEND_URL || "").replace(/\/$/, "");

// ===========================================================
// HARGA RESELLER
// Dipakai di dua feed produk publik (Topup Diamond & Marketplace) DAN di
// checkout. Titik hitungnya sengaja satu -- kalau harga yang tampil di toko
// dan harga yang ditagih dihitung di tempat berbeda, cepat atau lambat
// keduanya bakal beda angka.
//
// `harga_normal` ikut dikirim ke frontend supaya bisa ditampilkan sebagai
// harga coret. `harga_beli` TIDAK pernah ikut keluar (lihat pembersihan
// field di getProducts/getPublicCatalog) -- itu margin kita.
// ===========================================================
function terapkanHargaReseller(produkList, konteksReseller) {
    if (!konteksReseller || !konteksReseller.isReseller) return produkList;
    produkList.forEach((p) => {
        const hasil = hitungHargaReseller(p.harga_jual, p.harga_beli, konteksReseller.discountPercent);
        p.harga_normal = hasil.harga_normal;
        p.harga_jual = hasil.harga;
        p.harga_reseller = true;
    });
    return produkList;
}

function rupiahLog(n) {
    return "Rp" + Number(n).toLocaleString("id-ID");
}

// Mapping status TokoVoucher -> status internal topup_orders kita.
// FIX (Agustus 2026): sebelumnya `statusMap` cuma didefinisikan LOKAL di
// dalam reconcileTopupOrder(), padahal fulfillOrder() juga makai variabel
// yang sama tanpa pernah didefinisikan di scope-nya -> ReferenceError
// "statusMap is not defined" tiap kali fulfillOrder() jalan. Karena error
// itu dilempar SETELAH tokovoucher.createTransaction() sukses (diamond
// SUDAH terkirim), catch block di fulfillOrder nangkep error itu dan malah
// nge-set status order jadi "processing" lagi (bukan "sukses") -- makanya
// diamond masuk tapi status order kelihatan nyangkut/gagal keupdate
// otomatis di sisi user. Sekarang statusMap didefinisikan sekali di module
// scope biar dipakai bareng oleh fulfillOrder() dan reconcileTopupOrder().
const TOKOVOUCHER_STATUS_MAP = { sukses: "sukses", gagal: "gagal", pending: "processing" };

// ===========================================================
// bulatkanKeAtas, hitungMarkupWajar, MARKUP_TIERS, MARKUP_CAP_ABSOLUT,
// AUTO_MARKUP_ROUND — sekarang di-import dari utils/topupHelpers.js
// (lihat require di atas). Logic-nya IDENTIK, cuma dipindah ke shared
// module supaya catalogService.js juga bisa pakai tanpa circular dep.
// ===========================================================

// ===========================================================
// isForeignRegion, isForeignRegionCode, isForeignProduct,
// FOREIGN_REGION_KATEGORI, FOREIGN_REGION_CODE_PATTERNS —
// sekarang di-import dari utils/topupHelpers.js (lihat require di atas).
// ===========================================================

// ===========================================================
// AKTIVASI CERDAS — bantu admin milih produk mana yang perlu aktif dari
// katalog hasil sync (yang sering ada BANYAK varian buat nominal diamond
// yang sama/mirip dari supplier berbeda, plus nominal yang jarang dibeli).
//
// Alur:
// 1) Ambil "jumlah diamond" dari nama produk (nama_produk dari TokoVoucher,
//    formatnya beda-beda tiap game -- produk yang gak kebaca polanya
//    (paket/membership dll) DILEWATIN, gak disentuh sama sekali).
// 2) Kelompokin produk per kategori berdasarkan jumlah diamond yang SAMA
//    ATAU MIRIP (toleransi %, biar "86" & "85" gara-gara event bonus tetap
//    dianggap 1 tier).
// 3) Dalam 1 kelompok, cuma produk dengan HARGA MODAL PALING MURAH yang
//    diaktifkan -- sisanya (varian sama tapi lebih mahal) dinonaktifkan.
// 4) Kalau kategori itu SUDAH PERNAH ada histori order sukses: kelompok
//    yang gak pernah kejual sama sekali ikut dinonaktifkan juga (asumsi:
//    nominal itu emang jarang diminati). Kalau BELUM ada histori order
//    sama sekali (produk baru), langkah ini dilewatin -- gak ada data buat
//    nolak kelompok mana pun, jadi semua kelompok tetap dapet 1 produk aktif
//    (hasil langkah 3).
// ===========================================================

// Ambil angka nominal diamond dari nama produk, mis. "86 Diamonds" -> 86,
// "1.412 Diamond (706+706)" -> 1412. Return null kalau polanya gak ketemu.
function extractDiamondAmount(nama) {
    if (!nama) return null;
    const match = String(nama).match(/([\d.,]+)\s*(diamonds?|dm)\b/i);
    if (!match) return null;
    const digitsOnly = match[1].replace(/[.,]/g, "");
    const n = parseInt(digitsOnly, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
}

// -----------------------------------------------------------
// Produk "spesial" (bukan diamond angka) yang PALING SERING bikin duplikat
// kacau kalau deteksinya cuma 1 regex ketat yang nyaratin BEBERAPA kata
// muncul BARENGAN di nama. Di lapangan, penamaan dari tiap supplier beda-
// beda dan sering kepotong salah satu katanya -- misalnya "2X Weekly
// Diamond" (TANPA kata "Pass" sama sekali) tetep produk WDP tier 2, cuma
// nama dari supplier itu emang gak nyebut "Pass". Kalau syaratnya "harus
// ada kata diamond DAN pass", produk kayak gini gagal kebaca -> ke-skip
// -> status aktifnya dibiarin apa adanya SELAMANYA -> nongol nyampur di
// listing padahal harusnya di-dedupe.
//
// Makanya di sini dipakai KAMUS keyword per tipe (mirip cara reseller
// besar spt Codashop/UniPin nge-fix-in nama tier per game, bukan nebak
// dari teks bebas), dicek satu-satu. Setiap tipe dicek TERPISAH dari tipe
// lain di kategori yang sama (lihat pemakaiannya di smartActivateProducts)
// supaya WDP gak pernah nyampur ke cluster nominal diamond, dan Elite
// Pass/Membership gak pernah ikut ke cluster WDP.
//
// PENTING: urutan array WAJIB dari paling spesifik -- dicek satu-satu,
// berhenti di match pertama. Kalau nanti ketemu nama produk spesial baru
// yang belum kebaca (keliatan dari jumlah "skipped" di response), tinggal
// tambahin 1 baris kamus baru di sini -- gak perlu ubah logic lain.
const SPECIAL_TYPE_KEYWORDS = [
    { type: "weekly_pass", test: /\bwdp\b/i },
    { type: "weekly_pass", test: /weekly[^a-z]*diamond|diamond[^a-z]*weekly/i },
    { type: "twilight_pass", test: /twilight/i },
    { type: "starlight_membership", test: /starlight/i },
    { type: "growth_fund", test: /growth\s*fund/i },
    { type: "elite_pass", test: /\belite\b/i },
    { type: "membership", test: /membership|\bmember\b/i },
    // "M Cash"/"MCash"/"M-Cash" -- nama alternatif buat produk sejenis
    // diamond dari sebagian supplier. WAJIB dicek sebelum pola angka+Diamond
    // biasa, krn nama produk M Cash sering tetep nyebut angka diamond-nya
    // juga (mis. "10 Diamond (M Cash)") -- kalau gak dicek duluan, dia bakal
    // ketangkep pola diamond biasa dan nyampur sama produk Diamond asli.
    { type: "mcash", test: /\bm[\s-]?cash\b/i }
];

// Tipe yang punya NOMINAL ANGKA beneran (kayak Diamond -- 10, 50, 100, dst),
// BUKAN cuma "tier" langganan (1x/2x). M Cash termasuk sini krn nominalnya
// bervariasi kayak Diamond -- kalau disamain jadi "tier 1" semua, "10 M
// Cash" bakal ketuker sama "100 M Cash" dan salah satunya kematiin padahal
// keduanya nominal beda yang harus tetap aktif masing-masing. Tipe di luar
// set ini (weekly_pass, twilight_pass, dst) dianggap tier-based ("Nx").
const AMOUNT_BASED_TYPES = new Set(["diamond", "mcash"]);

// Ambil tier "Nx" dari nama produk pass/membership (1 = default kalau gak
// ada penanda "Nx"). Beda sama versi lama: TIDAK mensyaratkan kata "pass"
// ada di nama, jadi "2X Weekly Diamond" tetep kebaca tier 2.
function extractSpecialTier(nama) {
    const m = String(nama || "").match(/(\d+)\s*x\b/i);
    const tier = m ? parseInt(m[1], 10) : 1;
    return Number.isFinite(tier) && tier > 0 ? tier : 1;
}

// Ambil nominal angka dari nama produk M Cash, mis. "10 M Cash" -> 10,
// "M Cash 50" -> 50, "10 Diamond M Cash" -> 10 (ambil angka yang paling
// deket sama kata "M Cash"-nya, bukan angka lain yang mungkin nyasar di
// nama). Return null kalau beneran gak ketemu angka sama sekali.
function extractMcashAmount(nama) {
    const s = String(nama || "");
    const before = s.match(/([\d.,]+)\s*m[\s-]?cash/i);
    const after = before ? null : s.match(/m[\s-]?cash\D{0,10}?([\d.,]+)/i);
    const match = before || after;
    if (!match) return null;
    const n = parseInt(match[1].replace(/[.,]/g, ""), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
}

// Klasifikasi utama satu produk. URUTAN INI PENTING: kamus tipe spesial
// dicek DULUAN, baru fallback ke pola angka+Diamond biasa -- BUKAN
// sebaliknya. Alasannya: banyak produk spesial (Weekly Pass, M Cash, dll)
// namanya TETEP nyebut angka diamond di dalamnya (mis. "172 Diamond
// (Weekly)", "10 Diamond M Cash"). Kalau pola angka+Diamond dicek duluan,
// produk-produk ini keburu ketangkep sebagai "diamond" biasa dan nyampur
// ke cluster nominal Diamond asli -- padahal secara bisnis mereka SKU yang
// beda (harga modal, ketersediaan, atau jalur top up beda) dan gak boleh
// ikut dibandingin/di-dedupe bareng nominal Diamond biasa.
function classifyProduct(nama) {
    const special = SPECIAL_TYPE_KEYWORDS.find((k) => k.test.test(String(nama || "")));
    if (special) {
        const value = AMOUNT_BASED_TYPES.has(special.type) ? extractMcashAmount(nama) : extractSpecialTier(nama);
        // Amount-based (mcash) yang gagal ketemu angkanya -> anggap gak
        // kebaca (null) drpd asal nge-grup jadi 1 padahal nominalnya beda-beda
        if (value === null) return { groupType: null, groupValue: null };
        return { groupType: special.type, groupValue: value };
    }
    const diamond = extractDiamondAmount(nama);
    if (diamond !== null) return { groupType: "diamond", groupValue: diamond };
    return { groupType: null, groupValue: null };
}

// Kelompokin angka-angka yang berdekatan (selisih relatif <= tolerance)
// jadi satu cluster "sama/mirip". Dipakai per kategori.
// Toleransi 4% -- dari hasil riset ke Codashop/UniPin, variasi nominal dari
// supplier yang berbeda buat "nominal yang sama" biasanya cuma beda 1-3%
// (mis. 513/514/516, atau 568/569/570). 8% ternyata kadang masih misahin
// nominal yang secara bisnis harusnya dianggap 1 tier yang sama.
function clusterAmounts(amounts, tolerance = 0.04) {
    const sorted = [...new Set(amounts)].sort((a, b) => a - b);
    const clusters = [];
    for (const amt of sorted) {
        const last = clusters[clusters.length - 1];
        if (last && (amt - last.rep) / last.rep <= tolerance) {
            last.values.push(amt);
        } else {
            clusters.push({ rep: amt, values: [amt] });
        }
    }
    return clusters;
}

// Default batas nominal aktif per kategori KALAU admin gak isi manual.
// Dari riset ke Codashop/UniPin: platform besar emang nyediain puluhan
// nominal, TAPI itu baru masuk akal kalau ada data order buat milihnya.
// Tanpa histori sama sekali, lebih aman mulai dari jumlah yang moderat
// (bukan "semua nominal langsung aktif") biar daftar produk gak
// kebanjiran varian yang belum tentu laku.
const DEFAULT_MAX_AKTIF_PER_KATEGORI = 12;

// Dipakai KHUSUS pas kategori itu belum ada histori order sukses sama
// sekali, jadi gak ada cara buat tau nominal mana yang beneran diminati.
// Alih-alih ambil N cluster pertama yang ketemu (urutan sembarang) atau
// malah semuanya, kita ambil sebaran LOG dari yang termurah ke termahal --
// makin padat di nominal kecil, makin jarang di nominal besar. Ini niru
// pola asli yang kelihatan di katalog Codashop ID: nominal kecil (3-100an
// Diamond) jauh lebih banyak variannya dibanding nominal besar (>2000
// Diamond cuma ada beberapa opsi) -- karena nominal kecil emang yang paling
// sering dipakai buat top up harian.
function pilihSebaranLog(clustersAsc, cap) {
    if (clustersAsc.length <= cap) return clustersAsc;
    if (cap <= 1) return [clustersAsc[0]];
    const lastIndex = clustersAsc.length - 1;
    const picked = new Set();
    for (let i = 0; i < cap; i++) {
        // pangkat 1.6 -> indeks kepilih numpuk di awal (nominal kecil),
        // meregang ke ujung (nominal gede) biar tetap ada opsi buat "sultan"
        const t = Math.pow(i / (cap - 1), 1.6);
        picked.add(Math.round(t * lastIndex));
    }
    return [...picked].sort((a, b) => a - b).map((idx) => clustersAsc[idx]);
}

// ===========================================================
// AKTIVASI CERDAS — JALUR NON-GAME (etalase Marketplace/One Stop Solution:
// Pulsa, Paket Data, E-Wallet, PLN, Tagihan, Voucher, dst)
//
// Kenapa butuh jalur SENDIRI: clustering di atas didesain buat produk
// BERTINGKAT NOMINAL ala game (10/50/86 Diamond, Weekly Pass, dst) --
// nominalnya sengaja dicluster pakai toleransi persen dan dipangkas pakai
// cap + histori penjualan, karena satu game bisa punya puluhan nominal yang
// belum tentu laku semua. Produk non-game GAK gitu: nominal pulsa/PLN/
// e-wallet itu himpunan kecil yang pasti (5rb, 10rb, 20rb, ...) dan
// SEMUANYA emang harus tayang. Yang perlu dibersihin cuma DUPLIKAT: satu
// nominal yang sama sering muncul beberapa kali dari jalur supplier beda
// dengan harga modal beda.
//
// Jadi aturannya: per operator + jenis produk, ambil "sidik jari" produk
// (nominal kalau kebaca, kalau nggak ya nama yang udah dinormalisasi),
// terus AKTIFKAN yang harga modalnya paling murah dan nonaktifin sisanya
// yang identik. Gak ada cap, gak ada filter popularitas -- produk non-game
// baru dari sync otomatis ikut aktif.
// ===========================================================

// Satuan yang nempel di angka tapi BUKAN nominal rupiah (kuota & durasi).
const UNIT_BUKAN_NOMINAL = /(\d+(?:[.,]\d+)?\s*(gb|mb|kb|tb)\b)|(\d+\s*(hari|hr|jam|menit|mnt|bulan|bln)\b)/i;

// Produk paket data/langganan (ada kuota/durasi di namanya) SENGAJA gak
// di-dedupe pakai nominal: "3GB 30 Hari" dan "8GB 30 Hari" bisa kebetulan
// harganya sama persis, dan kalau dianggap satu grup salah satunya bakal
// dimatiin padahal SKU-nya beda. Buat produk kayak gini, sidik jarinya
// balik ke nama.
function namaPunyaSatuanKuota(nama) {
    return UNIT_BUKAN_NOMINAL.test(String(nama || ""));
}

// Ambil nominal rupiah dari nama produk non-game:
// "Telkomsel 10.000" -> 10000, "Pulsa Indosat 25rb" -> 25000,
// "Token PLN 20K" -> 20000, "Saldo DANA 1jt" -> 1000000.
// Return null kalau gak ada angka yang masuk akal sebagai nominal.
function extractMarketplaceNominal(nama) {
    const tokens = String(nama || "").toLowerCase().split(/[^a-z0-9.,]+/).filter(Boolean);
    const SUFFIX_JUTA = /^(jt|juta)$/;
    let best = null;

    for (let i = 0; i < tokens.length; i++) {
        const m = tokens[i].match(/^(\d+(?:[.,]\d+)*)(rb|ribu|k|jt|juta)?$/);
        if (!m) continue;

        const suffix = m[2] || (tokens[i + 1] && /^(rb|ribu|k|jt|juta)$/.test(tokens[i + 1]) ? tokens[i + 1] : "");
        let n;
        if (suffix) {
            // "25rb" / "1,5jt" -> angka desimalnya dikali pengali satuan
            const base = parseFloat(m[1].replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
            n = Math.round(base * (SUFFIX_JUTA.test(suffix) ? 1000000 : 1000));
        } else {
            n = parseInt(m[1].replace(/[.,]/g, ""), 10);
        }

        // Nominal produk non-game paling kecil di lapangan itu 1.000 --
        // angka di bawah itu biasanya bagian nama (mis. "4G", "Kartu 3").
        if (!Number.isFinite(n) || n < 1000) continue;
        if (best === null || n > best) best = n;
    }
    return best;
}

// Nama produk yang udah dinormalisasi, dipakai sebagai sidik jari cadangan
// kalau nominalnya gak kebaca (mis. "PLN Pascabayar", "PDAM Kota Bandung").
function marketplaceNameSignature(nama) {
    return String(nama || "")
        .toLowerCase()
        .replace(/\[(promo|new|baru)\]|\((promo|new|baru)\)/g, " ")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

function marketplaceSignature(nama) {
    if (!namaPunyaSatuanKuota(nama)) {
        const nominal = extractMarketplaceNominal(nama);
        if (nominal !== null) return `nominal:${nominal}`;
    }
    return `nama:${marketplaceNameSignature(nama)}`;
}

// Produk game (bertingkat nominal) vs produk marketplace. Dicek dari
// kategori NexShop hasil resolve DAN nama kategori asli TokoVoucher, biar
// tetap kebaca walaupun mapping kategorinya belum di-set admin (fallback
// DEFAULT_CATEGORY_MAP bisa ngasih "Topup Game", DB map ngasih "Gaming").
const POLA_KATEGORI_GAME = /topup\s*game|^gaming$|^games?$/;

function isGameTierProduct(p) {
    const kategoriNexshop = String(p.nexshop_category || p.kategori || "").trim().toLowerCase();
    const kategoriSumber = String(p.source_category_name || "").trim().toLowerCase();
    return isTopupGameCategory(kategoriNexshop) || POLA_KATEGORI_GAME.test(kategoriNexshop) || POLA_KATEGORI_GAME.test(kategoriSumber);
}

const SMART_ACTIVATE_COLUMNS =
    "id, kode_produk, nama, kategori, source_category_name, source_operator_id, source_operator_name, source_jenis_name, source_status, harga_beli, harga_jual, is_active, auto_managed, manual_category_override";

// Pemenang dalam satu grup = harga modal PALING MURAH. Kalau modalnya sama
// persis, dahulukan yang udah aktif (biar aksi ini idempoten, gak
// bolak-balik ganti produk aktif tiap dijalanin), baru urut kode produk.
function pilihPemenang(items) {
    return [...items].sort((a, b) => {
        const selisih = Number(a.harga_beli || 0) - Number(b.harga_beli || 0);
        if (selisih !== 0) return selisih;
        if (!!a.is_active !== !!b.is_active) return a.is_active ? -1 : 1;
        return String(a.kode_produk || "").localeCompare(String(b.kode_produk || ""));
    })[0];
}

exports.smartActivateProducts = async (req, res) => {
    if (!["admin", "staff"].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }

    const { ids, maxAktifPerKategori, applyToAll } = req.body;
    // applyToAll = jalanin ke SELURUH katalog (tombol "Aktivasi Cerdas
    // Semua" di dashboard), tanpa admin harus nyentang produk satu-satu.
    const semuaProduk = applyToAll === true || applyToAll === "true";
    if (!semuaProduk && (!Array.isArray(ids) || ids.length === 0)) {
        return res.status(400).json({ message: "ids wajib diisi (array), atau kirim applyToAll: true buat seluruh katalog" });
    }
    const cap = Number(maxAktifPerKategori) > 0 ? Number(maxAktifPerKategori) : DEFAULT_MAX_AKTIF_PER_KATEGORI;

    try {
        // loadAdminCatalog() udah ngurusin: paginasi (biar gak kepotong limit
        // 1000 baris PostgREST), buang produk region luar Indonesia, dan
        // resolve kategori NexShop + identitas operator per produk.
        const catalog = await loadAdminCatalog(SMART_ACTIVATE_COLUMNS);
        const wanted = semuaProduk ? null : new Set(ids.map(String));
        const scope = semuaProduk ? catalog : catalog.filter((p) => wanted.has(String(p.id)));
        const skippedForeignRegion = semuaProduk ? 0 : Math.max(ids.length - scope.length, 0);

        // Produk yang statusnya udah di-override manual admin (auto_managed =
        // false) atau lagi dimatiin supplier gak disentuh sama sekali --
        // konsisten sama applyToFilter/toggleOperator.
        let skippedManual = 0;
        let skippedSupplierOff = 0;
        const kandidat = [];
        scope.forEach((p) => {
            if (p.source_status && p.source_status !== "active") return skippedSupplierOff++;
            if (p.auto_managed === false) return skippedManual++;
            kandidat.push(p);
        });

        const produkGame = kandidat.filter(isGameTierProduct);
        const produkMarketplace = kandidat.filter((p) => !isGameTierProduct(p));

        // id -> status aktif yang diinginkan
        const target = new Map();

        // ---------- JALUR 1: produk game (bertingkat nominal) ----------
        const parsed = produkGame.map((p) => ({ ...p, ...classifyProduct(p.nama) }));
        const skipped = parsed.filter((p) => p.groupType === null);
        const groupable = parsed.filter((p) => p.groupType !== null);

        // Histori order sukses buat produk-produk ini, dipakai buat nentuin
        // kelompok mana yang "beneran laku" per game.
        const kodeSet = new Set(groupable.map((p) => p.kode_produk));
        const orderRows = kodeSet.size
            ? await fetchAllRows((from, to) =>
                  supabase.from("topup_orders").select("kode_produk").eq("status", "sukses").range(from, to)
              )
            : [];
        const salesCount = {};
        orderRows.forEach((o) => {
            if (!kodeSet.has(o.kode_produk)) return;
            salesCount[o.kode_produk] = (salesCount[o.kode_produk] || 0) + 1;
        });

        // Dikelompokkan per OPERATOR (= per game), bukan per kategori.
        // Kategori NexShop nampung SEMUA game dalam satu ember ("Gaming"),
        // jadi kalau dikelompokin per kategori, nominal 86 Diamond punya
        // game A bisa nyampur/nendang nominal 86 punya game B, dan cap
        // "maksimal N nominal aktif" kepakai buat seluruh game sekaligus.
        const byGame = {};
        groupable.forEach((p) => {
            const k = p.operator_id || p.kategori || "(tanpa operator)";
            if (!byGame[k]) byGame[k] = [];
            byGame[k].push(p);
        });

        let filterPopularitasDipakai = false;

        for (const game of Object.keys(byGame)) {
            const items = byGame[game];

            // Pisah dulu per TYPE (diamond, weekly_pass, twilight_pass,
            // elite_pass, membership, dst) SEBELUM di-cluster. Ini krusial --
            // kalau langsung di-cluster bareng tanpa pisah type dulu, produk
            // beda jenis yang kebetulan nilai "tier"-nya sama (mis. diamond
            // amount 1 vs WDP tier 1) bisa nyampur jadi 1 grup. Nominal
            // diamond -> di-cluster pakai toleransi % (varian supplier beda-
            // beda dikit dianggap 1 tier). Tipe spesial (WDP/Twilight/dst) ->
            // exact match tier, gak perlu toleransi krn nilainya diskrit kecil.
            const byType = {};
            items.forEach((p) => {
                if (!byType[p.groupType]) byType[p.groupType] = [];
                byType[p.groupType].push(p);
            });

            const groupsOfCluster = [];
            Object.entries(byType).forEach(([type, typeItems]) => {
                if (AMOUNT_BASED_TYPES.has(type)) {
                    clusterAmounts(typeItems.map((p) => p.groupValue)).forEach((c) => {
                        groupsOfCluster.push({ ...c, type, items: typeItems.filter((p) => c.values.includes(p.groupValue)) });
                    });
                } else {
                    [...new Set(typeItems.map((p) => p.groupValue))].forEach((tier) => {
                        groupsOfCluster.push({
                            rep: tier,
                            values: [tier],
                            type,
                            items: typeItems.filter((p) => p.groupValue === tier)
                        });
                    });
                }
            });

            let scored = groupsOfCluster.map((g) => {
                const winner = pilihPemenang(g.items);
                const totalSales = g.items.reduce((sum, p) => sum + (salesCount[p.kode_produk] || 0), 0);
                return { ...g, winner, totalSales };
            });

            const gamePunyaHistori = scored.some((g) => g.totalSales > 0);
            if (gamePunyaHistori) {
                filterPopularitasDipakai = true;
                scored = scored.filter((g) => g.totalSales > 0).sort((a, b) => b.totalSales - a.totalSales).slice(0, cap);
            } else {
                // belum ada data order sama sekali -> jangan asal ambil N pertama,
                // sebar berdasarkan nominal (lihat catatan di pilihSebaranLog)
                scored = pilihSebaranLog(
                    [...scored].sort((a, b) => a.rep - b.rep),
                    cap
                );
            }

            const winnerIds = new Set(scored.map((g) => g.winner.id));
            items.forEach((p) => target.set(p.id, winnerIds.has(p.id)));
        }

// Kategori NexShop yang produknya FUNGIBLE murni berdasarkan nominal --
        // beda "jenis"/jalur supplier TIDAK dianggap SKU yang beda secara bisnis
        // buat kategori ini, karena hasil akhir yang diterima pembeli PERSIS sama
        // gak peduli lewat jalur mana (top up DANA Rp1.000 ya tetap nambah saldo
        // Rp1.000, gak ada bedanya biar lewat jalur A atau B). Makanya jenis
        // SENGAJA dikeluarkan dari kunci dedup buat kategori-kategori ini -- beda
        // sama Pulsa (Reguler vs Transfer beneran beda cara kerja ke nomor tujuan)
        // yang TETAP mempertahankan jenis di kunci (lihat komentar di bawah).
        //
        // Tanpa ini: TokoVoucher sering nyediain nominal yang PERSIS sama (mis.
        // "DANA 1.000" & "Dana 1.000") lewat jenis produk yang beda-beda per
        // supplier -- dedup yang jenis-aware jadi nganggep itu 2 grup terpisah,
        // masing-masing tetap dapet 1 produk aktif sendiri-sendiri, jadi nominal
        // yang sama nongol dobel/triple di etalase padahal harusnya cuma 1 (yang
        // paling murah).
        const NOMINAL_FUNGIBLE_CATEGORIES = new Set(["e-wallet"]);

        // ---------- JALUR 2: produk non-game (Marketplace) ----------
        // Kunci grup: operator + (jenis produk, KECUALI kategori fungible
        // di atas) + sidik jari nominal/nama. Jenis ikut masuk kunci buat
        // kategori lain (Pulsa, dst) biar "Pulsa Reguler 10rb" gak diadu
        // sama "Pulsa Transfer 10rb" -- itu dua produk beda walau
        // nominalnya sama.
        const byMarketplaceGroup = new Map();
        produkMarketplace.forEach((p) => {
            const kategoriNexshop = String(p.nexshop_category || "").trim().toLowerCase();
            const abaikanJenis = NOMINAL_FUNGIBLE_CATEGORIES.has(kategoriNexshop);
            const key = [
                p.operator_id || p.kategori || "(tanpa operator)",
                abaikanJenis ? "" : String(p.source_jenis_name || "").trim().toLowerCase(),
                marketplaceSignature(p.nama)
            ].join("||");
            if (!byMarketplaceGroup.has(key)) byMarketplaceGroup.set(key, []);
            byMarketplaceGroup.get(key).push(p);
        });

        let duplikatMarketplace = 0;
        byMarketplaceGroup.forEach((items) => {
            const winner = pilihPemenang(items);
            duplikatMarketplace += items.length - 1;
            items.forEach((p) => target.set(p.id, p.id === winner.id));
        });

        // ---------- Terapkan perubahan ----------
        const beforeRows = [];
        const afterRows = [];
        let activated = 0;
        let deactivated = 0;

        kandidat.forEach((p) => {
            if (!target.has(p.id)) return;
            const aktif = target.get(p.id);
            // Produk yang diaktifin tapi harga jualnya masih 0 gak boleh
            // tayang tanpa harga -- isiin markup wajar sekalian.
            const perluHarga = aktif && (!p.harga_jual || Number(p.harga_jual) <= 0);
            if (!!p.is_active === aktif && !perluHarga) return;

            const before = { id: p.id, is_active: !!p.is_active };
            const after = { id: p.id, is_active: aktif };
            if (perluHarga) {
                before.harga_jual = p.harga_jual || 0;
                after.harga_jual = hitungMarkupWajar(p.harga_beli || 0);
            }
            beforeRows.push(before);
            afterRows.push(after);
            if (aktif) activated++;
            else deactivated++;
        });

        if (afterRows.length > 0) {
            // Update dikelompokin per payload yang identik lalu di-chunk --
            // 1 query per 200 produk, bukan 1 query per produk (mode
            // applyToAll bisa nyentuh puluhan ribu baris sekaligus).
            const groups = new Map();
            afterRows.forEach((row) => {
                const { id, ...payload } = row;
                const key = JSON.stringify(payload);
                if (!groups.has(key)) groups.set(key, { payload, ids: [] });
                groups.get(key).ids.push(id);
            });

            const chunkSize = 200;
            for (const { payload, ids: groupIds } of groups.values()) {
                for (let i = 0; i < groupIds.length; i += chunkSize) {
                    const { error } = await supabase
                        .from("topup_products")
                        .update({ ...payload, updated_at: new Date().toISOString() })
                        .in("id", groupIds.slice(i, i + chunkSize));
                    if (error) return res.status(500).json({ message: "Gagal update status produk" });
                }
            }

            await logAction({
                action: "smart_activate",
                label: `Aktivasi cerdas${semuaProduk ? " (semua produk)" : ""}: ${activated} aktif, ${deactivated} nonaktif`,
                ids: afterRows.map((r) => r.id),
                beforeRows,
                afterRows,
                adminEmail: req.user.email
            });
        }

        const ringkasanJalur = `${produkGame.length} produk game, ${produkMarketplace.length} produk non-game`;
        notify(
            "product",
            `🧠 ${req.user.email} menjalankan aktivasi cerdas${semuaProduk ? " ke SEMUA produk" : ""}: ${activated} diaktifkan, ${deactivated} dinonaktifkan (${ringkasanJalur})`
        );

        res.json({
            message: `Aktivasi cerdas selesai: ${activated} produk diaktifkan, ${deactivated} dinonaktifkan (${ringkasanJalur})${
                skipped.length ? `, ${skipped.length} produk game dilewatin (nominal gak kebaca dari namanya)` : ""
            }${skippedManual ? `, ${skippedManual} dilindungi (status di-override manual)` : ""}${
                skippedSupplierOff ? `, ${skippedSupplierOff} dilewatin (nonaktif di supplier)` : ""
            }${skippedForeignRegion ? `, ${skippedForeignRegion} dilewatin (region luar Indonesia / gak ketemu)` : ""}${
                produkGame.length && !filterPopularitasDipakai ? " — belum ada histori order sukses, jadi filter popularitas belum diterapkan" : ""
            }`,
            activated,
            deactivated,
            skipped: skipped.length,
            skippedManual,
            skippedSupplierOff,
            skippedForeignRegion,
            gameProducts: produkGame.length,
            marketplaceProducts: produkMarketplace.length,
            marketplaceDuplicates: duplikatMarketplace,
            popularityFilterApplied: filterPopularitasDipakai,
            appliedToAll: semuaProduk
        });
    } catch (err) {
        console.error("smartActivateProducts:", err.message);
        res.status(500).json({ message: "Server Error" });
    }
};

// ===========================================================
// UNDO/REDO — riwayat aksi bulk di produk topup (tabel
// product_action_history, lihat migrations-07-product-action-history.sql).
// Model stack standar: entri 'active' = riwayat masa lalu, entri 'undone' =
// riwayat yang udah di-undo (jadi "masa depan" buat redo). Undo ambil entri
// active PALING BARU; redo ambil entri undone PALING LAMA (yaitu yang
// posisinya paling deket sama batas active/undone).
// ===========================================================
const HISTORY_LIMIT = 50; // biar tabel riwayat gak numpuk tanpa batas

async function logAction({ action, label, ids, beforeRows, afterRows, adminEmail }) {
    // Aksi baru (bukan hasil undo/redo) -> buang dulu entri 'undone' yang
    // masih nyantol -- itu representasi cabang "masa depan" yang jadi gak
    // valid lagi begitu ada aksi baru (sama kayak Ctrl+Z lalu ngetik hal baru).
    await supabase.from("product_action_history").delete().eq("status", "undone");

    await supabase.from("product_action_history").insert({
        action,
        label,
        product_ids: ids,
        before_rows: beforeRows,
        after_rows: afterRows,
        status: "active",
        admin_email: adminEmail || null
    });

    const { data: rows } = await supabase
        .from("product_action_history")
        .select("id")
        .order("created_at", { ascending: false });
    if (rows && rows.length > HISTORY_LIMIT) {
        const staleIds = rows.slice(HISTORY_LIMIT).map((r) => r.id);
        await supabase.from("product_action_history").delete().in("id", staleIds);
    }
}

// Terapkan snapshot { id, ...kolom } ke masing-masing baris produk —
// dipakai bareng buat undo (before_rows) maupun redo (after_rows) semua
// aksi SELAIN 'delete' (yang butuh insert/delete penuh, ditangani terpisah
// di undoLastAction/redoLastAction).
async function applyRowSnapshot(rows) {
    const results = await Promise.all(
        (rows || []).map((r) => {
            const { id, ...cols } = r;
            return supabase
                .from("topup_products")
                .update({ ...cols, updated_at: new Date().toISOString() })
                .eq("id", id);
        })
    );
    const failed = results.find((r) => r.error);
    if (failed) throw new Error("Gagal menerapkan perubahan ke produk");
}

// Helper generik buat bulk-update yang cuma ganti SATU kolom ke nilai yang
// SAMA buat semua produk terpilih (status aktif, butuh_server_id, kategori,
// item_icon) — otomatis nyimpen snapshot before/after ke riwayat undo/redo.
async function bulkUpdateSimpleField({ ids, column, newValue, action, label, adminEmail }) {
    const { data: before, error: fetchErr } = await supabase
        .from("topup_products")
        .select(`id, ${column}, auto_managed`)
        .in("id", ids);
    if (fetchErr) throw new Error("Gagal mengambil data produk");

    const updatePayload = { [column]: newValue, updated_at: new Date().toISOString() };
    if (column === "is_active") {
        updatePayload.auto_managed = false; // Protect manual toggles
    }

    const { error: updateErr } = await supabase
        .from("topup_products")
        .update(updatePayload)
        .in("id", ids);
    if (updateErr) throw new Error("Gagal update produk");

    await logAction({
        action,
        label,
        ids,
        beforeRows: (before || []).map((p) => ({ id: p.id, [column]: p[column], auto_managed: p.auto_managed })),
        afterRows: (before || []).map((p) => ({ id: p.id, [column]: newValue, auto_managed: updatePayload.auto_managed !== undefined ? updatePayload.auto_managed : p.auto_managed })),
        adminEmail
    });
}

// ===========================================================
// PUBLIK — daftar produk topup yang aktif, buat halaman toko
// ===========================================================
// ===========================================================
// PUBLIK — cek nickname akun game (dipakai frontend sebelum checkout, biar
// customer bisa konfirmasi "ini benar akun saya" sebelum bayar). Cuma
// didukung buat game tertentu (lihat SUPPORTED_GAMES di config/apigames.js)
// dan cuma aktif kalau admin sudah isi ApiGames Merchant ID/Secret di
// Settings > API Keys. Kalau gak didukung/gak dikonfigurasi, return
// { supported: false } — frontend fallback ke peringatan manual, TIDAK
// nge-block checkout.
// ===========================================================
exports.checkNicknameHandler = async (req, res) => {
    const { kategori, tujuan, serverId } = req.body;
    if (!tujuan) {
        return res.status(400).json({ message: "tujuan (Player ID) wajib diisi" });
    }

    try {
        const result = await checkNickname({ kategori, tujuan, serverId });
        if (result && result.reason === "provider_unavailable") {
            return res.status(502).json(result);
        }
        res.json(result);
    } catch (err) {
        res.status(502).json({ available: false, reason: "provider_unavailable", message: "Layanan verifikasi nickname sedang tidak tersedia." });
    }
};

// ===========================================================
// PUBLIK — CEK TAGIHAN (inquiry) produk PASCABAYAR
//
// Cuma kategori Pascabayar TokoVoucher yang punya inquiry (PLN Pascabayar,
// PDAM, Telkom, BPJS, dst). Tiga hal yang WAJIB dijaga di sini:
//
// 1) Kategori produk DIVALIDASI ULANG DI SERVER lewat DB, bukan percaya
//    flag yang dikirim client -- kalau nggak, orang bisa nembak endpoint
//    ini pakai kode produk apa pun dan tiap tembakan tetap motong saldo.
// 2) Endpoint ini di-rate-limit ketat (lihat inquiryLimiter di routes),
//    karena tiap panggilan inquiry berbayar walau gak jadi transaksi.
// 3) Field harga dari TokoVoucher (price/admin/selling_price/sisa_saldo)
//    SENGAJA GAK diterusin ke customer. Harga yang berlaku tetap harga_jual
//    yang diatur admin, dan saldo/margin kita bukan urusan client.
// ===========================================================
function angkaAman(nilai) {
    const n = Number(nilai);
    return Number.isFinite(n) ? n : null;
}

exports.inquiryPascabayarHandler = async (req, res) => {
    const kodeProduk = String(req.body.kode_produk || "").trim();
    const tujuan = String(req.body.tujuan || "").trim();

    if (!kodeProduk || !tujuan) {
        return res.status(400).json({ success: false, message: "kode_produk dan tujuan wajib diisi" });
    }

    try {
        const { data: product, error } = await supabase
            .from("topup_products")
            .select("kode_produk, nama, is_active, source_status, source_category_id, source_category_name")
            .eq("kode_produk", kodeProduk)
            .maybeSingle();

        if (error) {
            return res.status(500).json({ success: false, message: "Gagal memeriksa produk" });
        }
        if (!product || !product.is_active || (product.source_status && product.source_status !== "active")) {
            return res.status(404).json({ success: false, message: "Produk tidak ditemukan atau sedang tidak tersedia" });
        }
        if (!isPascabayarProduct(product)) {
            return res.status(400).json({ success: false, message: "Produk ini bukan pascabayar, jadi gak ada tagihan yang bisa dicek." });
        }

        const refId = `INQ-${crypto.randomUUID()}`;
        const result = await tokovoucher.inquiryPascabayar({
            refId,
            kodeProduk: product.kode_produk,
            tujuan,
            serverId: String(req.body.server_id || "").trim()
        });

        const status = String((result && result.status) || "").toLowerCase();
        const sukses = status === "sukses" || status === "success" || status === "1";
        if (!sukses) {
            return res.status(422).json({
                success: false,
                message: (result && result.message) || "Tagihan tidak ditemukan. Cek lagi nomor/ID pelanggannya ya."
            });
        }

        res.json({
            success: true,
            customer_name: result.customer_name || result.nama_pelanggan || null,
            customer_no: result.customer_no || tujuan,
            tagihan: angkaAman(result.tagihan),
            denda: angkaAman(result.denda),
            jumlah_bulan: angkaAman(result.jml_bulan),
            periode: result.blnth || null,
            jatuh_tempo: result.due_date || null,
            keterangan: typeof result.data === "string" ? result.data : null,
            message: result.message || null
        });
    } catch (err) {
        console.error("inquiryPascabayar:", err.message);
        res.status(502).json({ success: false, message: "Layanan cek tagihan lagi gak bisa dihubungi. Coba lagi sebentar." });
    }
};

exports.getProducts = async (req, res) => {
    try {
        // Endpoint ini publik tapi pakai optionalAuth: kalau yang minta
        // ternyata reseller yang sudah disetujui, harga yang dikirim balik
        // langsung harga resellernya (plus harga normal buat dicoret).
        const konteksReseller = await getResellerContext(req.user && req.user.id);
        let allData = [];
        let page = 0;
        const pageSize = 1000;
        
        while (true) {
            const { data, error } = await supabase
                .from("topup_products")
                .select("*")
                .eq("is_active", true)
                .order("kategori", { ascending: true })
                .order("sort_order", { ascending: true })
                .order("harga_jual", { ascending: true })
                .range(page * pageSize, (page + 1) * pageSize - 1);

            if (error) {
                console.log(error);
                return res.status(500).json({ message: "Database Error" });
            }
            
            if (!data || data.length === 0) break;
            
            // DYNAMIC PRICING: if harga_jual is 0, calculate dynamically using backend markup rules.
            data.forEach(p => {
                if (!p.harga_jual || p.harga_jual === 0) {
                    p.harga_jual = hitungMarkupWajar(p.harga_beli || 0);
                }
            });
            
            terapkanHargaReseller(data, konteksReseller);
            data.forEach((p) => { delete p.harga_beli; }); // margin internal, jangan bocor ke publik

            allData.push(...data);
            if (data.length < pageSize) break;
            page++;
        }
        
        const data = allData;

        // Jaga-jaga (defense in depth): walaupun sync sekarang udah nolak produk
        // region luar Indonesia dari awal, baris LAMA yang kesimpen sebelum filter
        // ini ada masih mungkin nyangkut di DB. Disaring lagi di sini biar toko
        // publik gak PERNAH nampilin produk region luar Indonesia.
        const indoOnly = (data || []).filter((p) => !isForeignProduct(p.kategori, p.kode_produk));

        // Endpoint ini KHUSUS feed grid "Topup Diamond" (game) -- kategori
        // non-game (E-Wallet, PLN, Pulsa, dst) punya etalase sendiri di
        // Marketplace/One Stop Solution (lihat getPublicCatalog) dan gak
        // boleh ikut nongol di sini walaupun admin aktifin.
        // Pakai pengenalan game yang luas (bukan cuma kategori "Gaming"):
        // produk yang kategorinya kebaca "Topup Game"/"Voucher Game" juga
        // milik etalase ini. Kalau di sini tetap sempit sementara
        // Marketplace sudah menolak semua produk game, produk-produk itu
        // malah hilang dari DUA etalase sekaligus.
        const gameOnly = indoOnly.filter((p) => isGameProduct(p, p.kategori));

        // Buang SKU utilitas "Cek Nama/ID/Nickname/..." (lihat
        // isCheckerUtilityProduct) -- ini API verifikasi akun TokoVoucher,
        // bukan produk jualan, tapi bisa kelanjur aktif kayak baris lama
        // di DB atau ke-aktifin gak sengaja lewat bulk-activate.
        const sellableOnly = gameOnly.filter((p) => !isCheckerUtilityProduct(p.nama));
        res.json(sellableOnly);
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server Error" });
    }
};

// ===========================================================
// ADMIN — sync katalog dari TokoVoucher berdasarkan kode/prefix
// (mis. "ML" buat semua produk Mobile Legends). Produk baru masuk
// dalam keadaan is_active = false dan harga_jual udah dihitungin
// otomatis pakai MARKUP_TIERS (lihat hitungMarkupWajar di atas), admin
// tinggal cek/aktifkan di dashboard — bisa juga disesuaikan lagi lewat
// tombol "Markup Otomatis" atau "Terapkan Markup" manual kalau perlu.
// ===========================================================
exports.syncProducts = async (req, res) => {
    if (!["admin", "staff"].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }

    const { kode } = req.query;
    if (!kode) {
        return res.status(400).json({ message: "Parameter 'kode' wajib diisi, contoh: ML, FF, PUBG" });
    }

    try {
        const result = await tokovoucher.searchProducts(kode);

        if (!result || result.status !== 1 || !Array.isArray(result.data)) {
            return res.status(400).json({
                message: result?.error_msg || "Gagal mengambil produk dari TokoVoucher"
            });
        }

        // Buang produk region luar Indonesia (lihat isForeignRegion) SEBELUM
        // dipetakan -- jadi produk kayak "RM 5" (Malaysia) atau "VND 10"
        // (Vietnam) gak pernah ikut disimpen ke DB, gak ke-hitung markup, dan
        // otomatis gak pernah nongol di smart filter / aktivasi cerdas.
        const indoData = result.data.filter((p) => !isForeignProduct(p.operator_produk || p.category_name, p.code));
        const skippedForeignCount = result.data.length - indoData.length;

        const rows = indoData.map((p) => ({
            kode_produk: p.code,
            nama: p.nama_produk,
            kategori: p.operator_produk || p.category_name,
            deskripsi: p.deskripsi,
            harga_beli: p.price,
            // hanya set harga_jual saat produk BARU pertama kali masuk;
            // upsert di bawah pakai ignoreDuplicates:false jadi kita perlu
            // ambil produk existing dulu supaya harga_jual admin gak ketimpa
        }));

        if (rows.length === 0) {
            return res.json({
                message: skippedForeignCount
                    ? `Semua ${skippedForeignCount} produk hasil pencarian "${kode}" adalah region luar Indonesia, gak ada yang disinkronkan`
                    : `Gak ada produk ditemukan buat kode "${kode}"`,
                data: []
            });
        }

        const kodeList = rows.map((r) => r.kode_produk);
        const { data: existing } = await supabase
            .from("topup_products")
            .select("kode_produk, harga_jual, is_active, kategori")
            .in("kode_produk", kodeList);

        const existingMap = new Map((existing || []).map((e) => [e.kode_produk, e]));

        const upsertRows = rows.map((r) => {
            const prev = existingMap.get(r.kode_produk);
            return {
                ...r,
                harga_jual: prev ? prev.harga_jual : hitungMarkupWajar(r.harga_beli), // produk baru -> langsung dikasih markup wajar, admin tinggal sesuaikan kalau perlu
                is_active: prev ? prev.is_active : false,
                // produk yg udah ada: pertahankan kategori yang udah diatur admin
                // (misal habis dipindah manual), sync ulang gak nimpa balik
                kategori: prev ? prev.kategori : r.kategori,
                updated_at: new Date().toISOString()
            };
        });

        const { data, error } = await supabase
            .from("topup_products")
            .upsert(upsertRows, { onConflict: "kode_produk" })
            .select();

        if (error) {
            console.log(error);
            return res.status(500).json({ message: "Gagal menyimpan produk" });
        }

        res.json({
            message: `${data.length} produk berhasil disinkronkan${
                skippedForeignCount ? ` (${skippedForeignCount} produk region luar Indonesia dilewatin)` : ""
            }`,
            data
        });
    } catch (err) {
        console.log(err.response?.data || err.message);
        res.status(500).json({ message: "Gagal terhubung ke TokoVoucher" });
    }
};

// Ambil map kategori TokoVoucher -> kategori NexShop sebagai Map.
async function loadCategoryMap() {
    const { data, error } = await supabase
        .from("topup_category_map")
        .select("tokovoucher_category_name, nexshop_category_name");
    if (error) throw error;

    const map = new Map();
    (data || []).forEach((m) => map.set(m.tokovoucher_category_name, m.nexshop_category_name));
    return map;
}

// Ambil SELURUH produk topup region Indonesia (bukan cuma 1000 baris
// pertama), lengkap sama kategori NexShop + identitas operator yang udah
// di-resolve. Dipakai getAllProductsAdmin dan getCatalogSummary supaya
// dua-duanya PASTI lihat data yang sama persis.
async function loadAdminCatalog(columns = "*") {
    const [categoryMap, rows] = await Promise.all([
        loadCategoryMap(),
        fetchAllRows((from, to) =>
            supabase
                .from("topup_products")
                .select(columns)
                .order("id", { ascending: true })
                .range(from, to)
        )
    ]);

    // Buang produk region luar Indonesia yang mungkin masih nyangkut di DB
    // dari sync lama (sebelum filter region ada).
    return rows
        .filter((p) => !isForeignProduct(p.kategori, p.kode_produk, p.nama))
        .map((p) => {
            const op = resolveOperator(p);
            return {
                ...p,
                nexshop_category: resolveNexshopCategory(p, categoryMap),
                operator_id: op.id,
                operator_name: op.name
            };
        });
}

// ADMIN — list produk topup (termasuk nonaktif), buat tabel dashboard.
//
// Filter kategori/operator/pencarian dikerjain DI SERVER, bukan di browser.
// Alasannya dua: (1) katalog TokoVoucher isinya 11.000+ produk, ngirim
// semuanya ke browser tiap kali tab dibuka itu berat banget; (2) mapping
// kategori butuh tabel topup_category_map yang cuma bisa dibaca role
// "admin" — kalau mapping-nya dikerjain di browser, staff (dan admin yang
// map-nya belum ke-load) bakal lihat SEMUA produk jatuh ke "Lainnya" dan
// tabelnya kelihatan kosong terus.
//
// Respons: { data, total, limit, offset, category_counts, operators }
exports.getAllProductsAdmin = async (req, res) => {
    if (!["admin", "staff"].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    try {
        const catalog = await loadAdminCatalog();

        const category = String(req.query.category || "").trim();
        const operator = String(req.query.operator || "").trim();
        const status = String(req.query.status || "").trim(); // "active" | "inactive" | ""
        const q = String(req.query.q || "").trim().toLowerCase();

        // "ids" dipakai picker kode promo: minta produk tertentu aja.
        const idsParam = String(req.query.ids || "").trim();
        if (idsParam) {
            const wanted = new Set(idsParam.split(",").map((v) => v.trim()).filter(Boolean));
            const picked = catalog.filter((p) => wanted.has(String(p.id)));
            return res.json({ data: picked, total: picked.length, limit: picked.length, offset: 0, category_counts: {}, operators: [] });
        }

        let list = catalog;
        if (category) list = list.filter((p) => p.nexshop_category === category);
        if (operator) list = list.filter((p) => p.operator_id === operator);
        if (status === "active") list = list.filter((p) => !!p.is_active);
        if (status === "inactive") list = list.filter((p) => !p.is_active);
        if (q) {
            list = list.filter(
                (p) =>
                    String(p.nama || "").toLowerCase().includes(q) ||
                    String(p.kode_produk || "").toLowerCase().includes(q)
            );
        }

        // Daftar operator DI DALAM hasil filter sekarang — dipakai sidebar
        // biar admin bisa lompat ke game/operator tanpa reload apa pun.
        const operatorMap = new Map();
        list.forEach((p) => {
            if (!operatorMap.has(p.operator_id)) {
                operatorMap.set(p.operator_id, { id: p.operator_id, name: p.operator_name, total: 0, active: 0 });
            }
            const entry = operatorMap.get(p.operator_id);
            entry.total++;
            if (p.is_active) entry.active++;
        });

        list.sort((a, b) => {
            const byOperator = String(a.operator_name).localeCompare(String(b.operator_name), "id");
            if (byOperator !== 0) return byOperator;
            return (Number(a.harga_beli) || 0) - (Number(b.harga_beli) || 0);
        });

        const total = list.length;
        // limit=0 artinya "kirim semua yang cocok" (dipakai tombol pilih-semua).
        const rawLimit = req.query.limit === undefined ? 300 : parseInt(req.query.limit, 10);
        const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 5000) : total;
        const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

        res.json({
            data: list.slice(offset, offset + limit),
            total,
            limit,
            offset,
            operators: [...operatorMap.values()].sort((a, b) => a.name.localeCompare(b.name, "id"))
        });
    } catch (err) {
        console.error("getAllProductsAdmin:", err.message);
        res.status(500).json({ message: "Gagal mengambil data produk topup" });
    }
};

// ADMIN — update harga jual / aktif / butuh server id / urutan tampil
exports.updateProduct = async (req, res) => {
    if (!["admin", "staff"].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    const { id } = req.params;
    const { harga_jual, is_active, butuh_server_id, sort_order, nama, kategori, operator_logo, item_icon } = req.body;

    const payload = { updated_at: new Date().toISOString() };
    if (harga_jual !== undefined) payload.harga_jual = harga_jual;
    if (is_active !== undefined) payload.is_active = is_active;
    if (butuh_server_id !== undefined) payload.butuh_server_id = butuh_server_id;
    if (sort_order !== undefined) payload.sort_order = sort_order;
    if (nama !== undefined) payload.nama = nama;
    if (kategori !== undefined) payload.kategori = kategori;
    if (operator_logo !== undefined) payload.operator_logo = operator_logo;
    if (item_icon !== undefined) payload.item_icon = item_icon;

    try {
        const { data, error } = await supabase
            .from("topup_products")
            .update(payload)
            .eq("id", id)
            .select();

        if (error) return res.status(500).json({ message: "Gagal update produk" });
        if (!data.length) return res.status(404).json({ message: "Produk tidak ditemukan" });

        res.json({ message: "Produk berhasil diperbarui", data: data[0] });
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

// ADMIN — nyala/matiin SATU KATEGORI/GAME sekaligus (semua produk di
// dalamnya), dipakai buat toggle "Kelola Kategori" di dashboard — biar admin
// gak perlu filter+select-all+bulk-status manual tiap mau sembunyiin
// satu game dari toko.
exports.setKategoriActive = async (req, res) => {
    if (!["admin", "staff"].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    const { kategori, is_active } = req.body;
    if (!kategori) {
        return res.status(400).json({ message: "kategori wajib diisi" });
    }
    try {
        const { error } = await supabase
            .from("topup_products")
            .update({ is_active: !!is_active, updated_at: new Date().toISOString() })
            .eq("kategori", kategori);

        if (error) return res.status(500).json({ message: "Gagal mengubah status kategori" });
        notify("product", `${is_active ? "✅" : "🚫"} ${req.user.email} ${is_active ? "mengaktifkan" : "menonaktifkan"} kategori "${kategori}" (semua produk)`);
        res.json({ message: `Kategori "${kategori}" berhasil ${is_active ? "diaktifkan" : "dinonaktifkan"}` });
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

// ADMIN — set logo game (operator_logo) buat SEMUA produk dalam satu kategori
// sekaligus, jadi admin gak perlu edit logo satu-satu per denominasi diamond.
exports.updateCategoryLogo = async (req, res) => {
    if (!["admin", "staff"].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    const { kategori, operator_logo } = req.body;
    if (!kategori || !operator_logo) {
        return res.status(400).json({ message: "kategori dan operator_logo wajib diisi" });
    }
    try {
        const { error } = await supabase
            .from("topup_products")
            .update({ operator_logo, updated_at: new Date().toISOString() })
            .eq("kategori", kategori);

        if (error) return res.status(500).json({ message: "Gagal update logo game" });
        notify("product", `🖼️ ${req.user.email} mengubah logo game "${kategori}"`);
        res.json({ message: `Logo game "${kategori}" berhasil diperbarui` });
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

// ADMIN — aktifkan/nonaktifkan banyak produk sekaligus (checkbox massal di
// dashboard), jadi gak perlu buka modal edit satu-satu.
exports.bulkUpdateStatus = async (req, res) => {
    if (!["admin", "staff"].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    const { ids, is_active } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "ids wajib diisi (array)" });
    }
    try {
        await bulkUpdateSimpleField({
            ids,
            column: "is_active",
            newValue: !!is_active,
            action: "status",
            label: `${is_active ? "Aktifkan" : "Nonaktifkan"} ${ids.length} produk`,
            adminEmail: req.user.email
        });
        notify("product", `${is_active ? "✅" : "🚫"} ${req.user.email} ${is_active ? "mengaktifkan" : "menonaktifkan"} ${ids.length} produk topup sekaligus`);
        res.json({ message: `${ids.length} produk berhasil ${is_active ? "diaktifkan" : "dinonaktifkan"}` });
    } catch (err) {
        res.status(500).json({ message: err.message || "Server Error" });
    }
};

// ADMIN — set/lepas toggle "butuh server id" buat banyak produk sekaligus
// (checkbox massal di dashboard), misalnya abis sync produk Mobile Legends
// baru yang semuanya perlu Zone ID, gak perlu buka edit satu-satu.
exports.bulkUpdateButuhServerId = async (req, res) => {
    if (!["admin", "staff"].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    const { ids, butuh_server_id } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "ids wajib diisi (array)" });
    }
    try {
        await bulkUpdateSimpleField({
            ids,
            column: "butuh_server_id",
            newValue: !!butuh_server_id,
            action: "server_id",
            label: `${butuh_server_id ? "Aktifkan" : "Matikan"} Butuh Server ID utk ${ids.length} produk`,
            adminEmail: req.user.email
        });
        notify(
            "product",
            `${butuh_server_id ? "🆔" : "🚫"} ${req.user.email} ${butuh_server_id ? "mengaktifkan" : "mematikan"} "Butuh Server ID" utk ${ids.length} produk topup sekaligus`
        );
        res.json({ message: `${ids.length} produk berhasil ${butuh_server_id ? "ditandai butuh" : "ditandai gak butuh"} Server ID` });
    } catch (err) {
        res.status(500).json({ message: err.message || "Server Error" });
    }
};

// ADMIN — hitung ulang harga_jual OTOMATIS dari harga_beli (modal) buat
// banyak produk sekaligus, pakai markup persen atau nominal rupiah + opsi
// pembulatan. Ini yang bikin admin gak perlu buka modal edit satu-satu tiap
// produk cuma buat naikin harga jual dari harga modalnya.
exports.bulkMarkupPrice = async (req, res) => {
    if (!["admin", "staff"].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    const { ids, type, value, rounding } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "ids wajib diisi (array)" });
    }
    if (type !== "percent" && type !== "nominal") {
        return res.status(400).json({ message: "type harus 'percent' atau 'nominal'" });
    }
    const markupValue = Number(value);
    if (isNaN(markupValue) || markupValue < 0) {
        return res.status(400).json({ message: "value markup gak valid" });
    }
    const round = Number(rounding) || 0; // 0 = gak dibulatkan

    try {
        const { data: productsRaw, error: fetchErr } = await supabase
            .from("topup_products")
            .select("id, harga_beli, harga_jual, kategori, kode_produk")
            .in("id", ids);
        if (fetchErr) return res.status(500).json({ message: "Gagal mengambil data produk" });

        // Markup manual cuma buat produk region Indonesia
        const products = (productsRaw || []).filter((p) => !isForeignProduct(p.kategori, p.kode_produk));
        const skippedForeignRegion = (productsRaw || []).length - products.length;

        const rows = products.map((p) => {
            const modal = Number(p.harga_beli) || 0;
            const jual = type === "percent" ? modal * (1 + markupValue / 100) : modal + markupValue;
            return { id: p.id, harga_jual: bulatkanKeAtas(jual, round) };
        });

        // update satu-satu per baris (paralel) — LEBIH AMAN daripada upsert partial-column,
        // yang berisiko kena constraint NOT NULL kolom lain (kode_produk, nama, dst) yang gak disertakan
        const results = await Promise.all(
            rows.map((r) =>
                supabase
                    .from("topup_products")
                    .update({ harga_jual: r.harga_jual, updated_at: new Date().toISOString() })
                    .eq("id", r.id)
            )
        );
        const failed = results.find((r) => r.error);
        if (failed) return res.status(500).json({ message: "Gagal update harga jual" });

        const markupLabel = type === "percent" ? `${markupValue}%` : `Rp${markupValue}`;
        await logAction({
            action: "markup",
            label: `Markup ${markupLabel} ke ${rows.length} produk`,
            ids: rows.map((r) => r.id),
            beforeRows: products.map((p) => ({ id: p.id, harga_jual: p.harga_jual })),
            afterRows: rows,
            adminEmail: req.user.email
        });

        notify("product", `💰 ${req.user.email} menerapkan markup ${markupLabel} ke ${rows.length} produk topup`);
        res.json({
            message: `Harga jual ${rows.length} produk berhasil dihitung ulang dari harga modal${
                skippedForeignRegion ? ` (${skippedForeignRegion} produk region luar Indonesia dilewatin)` : ""
            }`
        });
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

// ADMIN — sama kayak bulkMarkupPrice, tapi persennya GAK diinput manual:
// dihitung sendiri dari MARKUP_TIERS berdasarkan besaran harga modal
// masing-masing produk (jadi produk terpilih bisa punya harga_beli
// beda-beda dan tetap dapet markup yang "wajar" buat rentangnya masing-
// masing). Cocok dipakai abis sync produk baru (misal semua item diamond
// satu game) biar harganya langsung disesuaikan tanpa itung manual.
exports.autoMarkupPrice = async (req, res) => {
    if (!["admin", "staff"].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "ids wajib diisi (array)" });
    }

    try {
        const { data: productsRaw, error: fetchErr } = await supabase
            .from("topup_products")
            .select("id, harga_beli, harga_jual, kategori")
            .in("id", ids);
        if (fetchErr) return res.status(500).json({ message: "Gagal mengambil data produk" });

        // Markup otomatis cuma buat produk region Indonesia
        const products = (productsRaw || []).filter((p) => !isForeignProduct(p.kategori, p.kode_produk));
        const skippedForeignRegion = (productsRaw || []).length - products.length;

        const rows = products.map((p) => ({
            id: p.id,
            harga_jual: hitungMarkupWajar(p.harga_beli)
        }));

        const results = await Promise.all(
            rows.map((r) =>
                supabase
                    .from("topup_products")
                    .update({ harga_jual: r.harga_jual, updated_at: new Date().toISOString() })
                    .eq("id", r.id)
            )
        );
        const failed = results.find((r) => r.error);
        if (failed) return res.status(500).json({ message: "Gagal update harga jual" });

        await logAction({
            action: "auto_markup",
            label: `Markup otomatis (wajar) ke ${rows.length} produk`,
            ids: rows.map((r) => r.id),
            beforeRows: products.map((p) => ({ id: p.id, harga_jual: p.harga_jual })),
            afterRows: rows,
            adminEmail: req.user.email
        });

        notify("product", `🤖 ${req.user.email} menerapkan markup otomatis (wajar) ke ${rows.length} produk topup`);
        res.json({
            message: `Harga jual ${rows.length} produk berhasil dihitung otomatis dari harga modal${
                skippedForeignRegion ? ` (${skippedForeignRegion} produk region luar Indonesia dilewatin)` : ""
            }`
        });
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

// ADMIN — set item_icon (ikon per denominasi, kolom "Icon" di tabel) buat
// banyak produk sekaligus berdasarkan pilihan checkbox massal, biar admin
// gak perlu buka modal edit satu-satu tiap produk. Beda dari
// updateCategoryLogo yang isi operator_logo (logo game, dipakai di toko).
exports.bulkUpdateIcon = async (req, res) => {
    if (!["admin", "staff"].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    const { ids, item_icon } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "ids wajib diisi (array)" });
    }
    if (!item_icon) {
        return res.status(400).json({ message: "item_icon wajib diisi" });
    }
    try {
        await bulkUpdateSimpleField({
            ids,
            column: "item_icon",
            newValue: item_icon,
            action: "icon",
            label: `Ganti icon ${ids.length} produk`,
            adminEmail: req.user.email
        });
        notify("product", `🖼️ ${req.user.email} mengubah icon ${ids.length} produk topup sekaligus`);
        res.json({ message: `Icon berhasil diterapkan ke ${ids.length} produk` });
    } catch (err) {
        res.status(500).json({ message: err.message || "Server Error" });
    }
};

// ADMIN — pindahkan produk terpilih (checkbox massal) ke kategori lain
// sekaligus. Tool umum buat rapiin/gabungin kategori kalau ada produk yang
// kepisah/salah kategori pas sync dari TokoVoucher.
exports.bulkUpdateKategori = async (req, res) => {
    if (!["admin", "staff"].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    const { ids, kategori } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "ids wajib diisi (array)" });
    }
    if (!kategori || !kategori.trim()) {
        return res.status(400).json({ message: "kategori tujuan wajib diisi" });
    }
    try {
        const targetKategori = kategori.trim();
        await bulkUpdateSimpleField({
            ids,
            column: "kategori",
            newValue: targetKategori,
            action: "kategori",
            label: `Pindahkan ${ids.length} produk ke kategori "${targetKategori}"`,
            adminEmail: req.user.email
        });
        notify("product", `📂 ${req.user.email} memindahkan ${ids.length} produk topup ke kategori "${targetKategori}"`);
        res.json({ message: `${ids.length} produk berhasil dipindahkan ke kategori "${targetKategori}"` });
    } catch (err) {
        res.status(500).json({ message: err.message || "Server Error" });
    }
};

// ADMIN — hapus banyak produk sekaligus berdasarkan pilihan checkbox (beda
// dari deleteAllProducts yang hapus SEMUA/per-kategori)
exports.bulkDeleteProducts = async (req, res) => {
    if (!["admin", "staff"].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "ids wajib diisi (array)" });
    }
    try {
        const { data: before, error: fetchErr } = await supabase.from("topup_products").select("*").in("id", ids);
        if (fetchErr) return res.status(500).json({ message: "Gagal mengambil data produk" });

        const { error } = await supabase.from("topup_products").delete().in("id", ids);
        if (error) return res.status(500).json({ message: "Gagal menghapus produk terpilih" });

        await logAction({
            action: "delete",
            label: `Hapus ${ids.length} produk`,
            ids,
            beforeRows: before || [],
            afterRows: null,
            adminEmail: req.user.email
        });

        res.json({ message: `${ids.length} produk berhasil dihapus` });
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

// ADMIN — undo aksi bulk PALING BARU (markup, status, server id, kategori,
// icon, atau hapus) yang belum di-undo. Lihat catatan model stack di atas
// deklarasi logAction().
exports.undoLastAction = async (req, res) => {
    if (!["admin", "staff"].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    try {
        const { data: entries, error } = await supabase
            .from("product_action_history")
            .select("*")
            .eq("status", "active")
            .order("created_at", { ascending: false })
            .limit(1);
        if (error) return res.status(500).json({ message: "Gagal mengambil riwayat aksi" });
        if (!entries || entries.length === 0) {
            return res.status(400).json({ message: "Gak ada aksi buat di-undo" });
        }

        const entry = entries[0];
        if (entry.action === "delete") {
            if (entry.before_rows && entry.before_rows.length > 0) {
                const { error: insErr } = await supabase.from("topup_products").insert(entry.before_rows);
                if (insErr) return res.status(500).json({ message: "Gagal mengembalikan produk yang dihapus" });
            }
        } else {
            await applyRowSnapshot(entry.before_rows);
        }

        await supabase.from("product_action_history").update({ status: "undone" }).eq("id", entry.id);
        notify("product", `↩️ ${req.user.email} meng-undo aksi: ${entry.label}`);
        res.json({ message: `Berhasil di-undo: ${entry.label}`, label: entry.label });
    } catch (err) {
        res.status(500).json({ message: err.message || "Server Error" });
    }
};

// ADMIN — redo aksi yang paling terakhir di-undo (kebalikan dari undoLastAction)
exports.redoLastAction = async (req, res) => {
    if (!["admin", "staff"].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    try {
        const { data: entries, error } = await supabase
            .from("product_action_history")
            .select("*")
            .eq("status", "undone")
            .order("created_at", { ascending: true })
            .limit(1);
        if (error) return res.status(500).json({ message: "Gagal mengambil riwayat aksi" });
        if (!entries || entries.length === 0) {
            return res.status(400).json({ message: "Gak ada aksi buat di-redo" });
        }

        const entry = entries[0];
        if (entry.action === "delete") {
            const { error: delErr } = await supabase.from("topup_products").delete().in("id", entry.product_ids);
            if (delErr) return res.status(500).json({ message: "Gagal menghapus ulang produk" });
        } else {
            await applyRowSnapshot(entry.after_rows);
        }

        await supabase.from("product_action_history").update({ status: "active" }).eq("id", entry.id);
        notify("product", `↪️ ${req.user.email} meng-redo aksi: ${entry.label}`);
        res.json({ message: `Berhasil di-redo: ${entry.label}`, label: entry.label });
    } catch (err) {
        res.status(500).json({ message: err.message || "Server Error" });
    }
};

// ADMIN — status ringkas buat tombol Undo/Redo di dashboard (enable/disable
// + label tooltip "aksi apa yang bakal di-undo/redo")
exports.getActionHistoryStatus = async (req, res) => {
    if (!["admin", "staff"].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    try {
        const [lastActive, lastUndone] = await Promise.all([
            supabase.from("product_action_history").select("label").eq("status", "active").order("created_at", { ascending: false }).limit(1),
            supabase.from("product_action_history").select("label").eq("status", "undone").order("created_at", { ascending: true }).limit(1)
        ]);
        res.json({
            canUndo: !!(lastActive.data && lastActive.data.length),
            undoLabel: lastActive.data?.[0]?.label || null,
            canRedo: !!(lastUndone.data && lastUndone.data.length),
            redoLabel: lastUndone.data?.[0]?.label || null
        });
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

exports.deleteProduct = async (req, res) => {
    if (!["admin", "staff"].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    const { id } = req.params;
    try {
        const { error } = await supabase.from("topup_products").delete().eq("id", id);
        if (error) return res.status(500).json({ message: "Gagal menghapus produk" });
        res.json({ message: "Produk berhasil dihapus" });
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

// ADMIN — hapus SEMUA produk topup sekaligus (biar gak perlu klik hapus satu-satu).
// Opsional: kirim ?kategori=Mobile Legends buat cuma hapus produk di kategori/game itu saja.
exports.deleteAllProducts = async (req, res) => {
    if (!["admin", "staff"].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    const { kategori } = req.query;
    try {
        let query = supabase.from("topup_products").delete();
        query = kategori ? query.eq("kategori", kategori) : query.not("id", "is", null); // .not(...) trik supaya delete tanpa filter tetap valid di Supabase

        const { error, count } = await query.select("id", { count: "exact" });
        if (error) {
            console.log(error);
            return res.status(500).json({ message: "Gagal menghapus semua produk" });
        }

        notify("product", `🗑️ ${req.user.email} menghapus SEMUA produk topup${kategori ? ` kategori "${kategori}"` : ""}`);
        res.json({ message: kategori ? `Semua produk kategori "${kategori}" berhasil dihapus` : "Semua produk topup berhasil dihapus" });
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server Error" });
    }
};

// ===========================================================
// CHECKOUT — bikin order topup + transaksi iPaymu (guest ATAU login,
// sama seperti checkout produk biasa)
// ===========================================================
exports.create = async (req, res) => {
    const { kode_produk, tujuan, server_id, recipient_email, recipient_phone, promo_code, payment_method, payment_channel } = req.body;
    const userId = req.user ? req.user.id : null;

    if (!kode_produk || !tujuan) {
        return res.status(400).json({ message: "Produk dan tujuan (Player ID) wajib diisi" });
    }

    // Wajib diisi & harus nomor asli -- fallback default sebelumnya
    // ("08123456789" di ipaymu.js) dipakai berulang di semua transaksi dan
    // diduga jadi penyebab iPaymu Direct Payment nolak dengan "Suspicious buyer".
    const normalizedPhone = String(recipient_phone || "").trim();
    if (!/^(0|62)[0-9]{8,14}$/.test(normalizedPhone)) {
        return res.status(400).json({ message: "Nomor HP tidak valid (contoh: 08... atau 628...)" });
    }

    const normalizedPaymentMethod = String(payment_method || "").trim().toLowerCase();
    const ipaymuPaymentMethod = IPAYMU_PAYMENT_METHODS[normalizedPaymentMethod];
    if (!ipaymuPaymentMethod) {
        return res.status(400).json({ message: "Pilih metode pembayaran terlebih dahulu" });
    }

    try {
        const { data: product, error: prodErr } = await supabase
            .from("topup_products")
            .select("nama, kode_produk, harga_beli, harga_jual, butuh_server_id")
            .eq("kode_produk", kode_produk)
            .eq("is_active", true)
            .maybeSingle();

        if (prodErr || !product) {
            return res.status(404).json({ message: "Produk topup tidak ditemukan atau tidak aktif" });
        }
        
        // DYNAMIC PRICING: if harga_jual is 0, calculate dynamically using backend markup rules.
        if (!product.harga_jual || product.harga_jual === 0) {
            product.harga_jual = hitungMarkupWajar(product.harga_beli || 0);
        }

        // HARGA RESELLER — dihitung ULANG di sini dari data DB, bukan dari
        // apa pun yang dikirim frontend. Ditaruh SEBELUM promo & total
        // dihitung, jadi semua turunannya (subtotal, item iPaymu, potongan
        // promo) otomatis ikut harga reseller.
        const konteksReseller = await getResellerContext(userId);
        let hargaNormal = product.harga_jual;
        let hematReseller = 0;
        if (konteksReseller.isReseller) {
            const hasil = hitungHargaReseller(product.harga_jual, product.harga_beli, konteksReseller.discountPercent);
            hargaNormal = hasil.harga_normal;
            hematReseller = hasil.hemat;
            product.harga_jual = hasil.harga;
        }

        if (product.butuh_server_id && !server_id) {
            return res.status(400).json({ message: "Server ID wajib diisi untuk produk ini" });
        }

        // Cart topup selalu 1 item (id = kode_produk, biar bisa dipakai admin
        // buat batasi kode promo ke produk topup tertentu lewat kode_produk-nya
        // -- sama seperti checkout produk biasa, JANGAN pernah percaya nominal
        // diskon dari frontend, validasi ulang di server pakai harga dari DB.
        const cartItems = [{ id: product.kode_produk, price: product.harga_jual, quantity: 1 }];
        let discountAmount = 0;
        let appliedPromoCode = null;

        if (promo_code) {
            const promoResult = await validatePromoCode(promo_code, cartItems, recipient_email);
            if (!promoResult.valid) {
                return res.status(400).json({ message: promoResult.message });
            }
            discountAmount = promoResult.discount;
            appliedPromoCode = promoResult.promo.code;
        }

        const total = Math.max(product.harga_jual - discountAmount, 0);

        // Endpoint tracking guest bersifat publik, jadi ID harus benar-benar
        // tidak dapat ditebak dari waktu checkout.
        const orderId = "TP" + crypto.randomBytes(12).toString("hex").toUpperCase();

        const { error: insertErr } = await supabase.from("topup_orders").insert([{
            id: orderId,
            user_id: userId,
            kode_produk: product.kode_produk,
            nama_produk: product.nama,
            tujuan,
            server_id: server_id || null,
            recipient_email: recipient_email || null,
            recipient_phone: normalizedPhone,
            harga: total,
            subtotal: product.harga_jual,
            promo_code: appliedPromoCode,
            discount_amount: discountAmount,
            payment_method: normalizedPaymentMethod,
            status: "pending"
        }]);

        if (insertErr) {
            console.log(insertErr);
            return res.status(500).json({ message: "Gagal membuat pesanan topup" });
        }

        // Diskon (kalau ada) disebar ke item ini sendiri -- BUKAN dikirim
        // sebagai baris harga negatif ke iPaymu (itu yang diduga bikin
        // returnUrl gak balik normal ke web pas ada kode promo dipakai).
        const ipaymuItems = buildDiscountedIpaymuItems(
            [{ id: product.kode_produk, name: product.nama, price: product.harga_jual, quantity: 1 }],
            discountAmount
        );

        let isDirect = isDirectPaymentMethod(normalizedPaymentMethod);

        let payment;
        let debugDirectError = null;
        try {
            if (isDirect) {
                try {
                    // Ensure phone starts with 0 for iPaymu to avoid format rejection
                    let ipaymuPhone = normalizedPhone;
                    if (ipaymuPhone.startsWith("62")) {
                        ipaymuPhone = "0" + ipaymuPhone.substring(2);
                    }

                    payment = await createDirectPayment({
                        referenceId: orderId,
                        amount: total,
                        buyerName: req.user ? req.user.fullname : "Player " + tujuan,
                        buyerEmail: recipient_email,
                        buyerPhone: ipaymuPhone,
                        paymentMethod: ipaymuPaymentMethod,
                        paymentChannel: payment_channel,
                        notifyUrl: `${BACKEND_URL}/api/topup/notification`
                    });
                } catch (directErr) {
                    debugDirectError = (directErr.ipaymuResponse && directErr.ipaymuResponse.Message) || directErr.message;
                    console.log(
                        directErr.isTimeout
                            ? `Direct payment TIMEOUT (kemungkinan IP VPS belum di-whitelist iPaymu Direct Payment), fallback ke redirect: ${directErr.message}`
                            : "Direct payment failed (IP whitelist/channel error), falling back to redirect:",
                        directErr.ipaymuResponse || directErr.message
                    );
                    notify(
                        "topup",
                        `⚠️ Fallback direct→redirect utk topup order ${orderId}: ${
                            directErr.isTimeout
                                ? "TIMEOUT (kemungkinan IP VPS belum di-whitelist iPaymu Direct Payment)"
                                : (debugDirectError || "unknown error")
                        }`
                    );
                    isDirect = false;
                }
            }

            if (!isDirect) {
                // Same logic for redirect fallback
                let ipaymuPhone = normalizedPhone;
                if (ipaymuPhone.startsWith("62")) {
                    ipaymuPhone = "0" + ipaymuPhone.substring(2);
                }

                payment = await createRedirectPayment({
                    referenceId: orderId,
                    itemDetails: ipaymuItems,
                    buyerName: req.user ? req.user.fullname : "Player " + tujuan,
                    buyerEmail: recipient_email || undefined,
                    buyerPhone: ipaymuPhone,
                    returnUrl: `${FRONTEND_URL}/#/payment-status?order=${orderId}&status=success`,
                    cancelUrl: `${FRONTEND_URL}/#/payment-status?order=${orderId}&status=cancel`,
                    notifyUrl: `${BACKEND_URL}/api/topup/notification`,
                    paymentMethod: ipaymuPaymentMethod
                });
            }
        } catch (ipaymuErr) {
            console.log("iPaymu error:", ipaymuErr.ipaymuResponse || ipaymuErr.message);
            await supabase.from("topup_orders").update({ status: "failed" }).eq("id", orderId);
            return res.status(500).json({ message: "Gagal membuat transaksi pembayaran" });
        }

        const updatePayload = isDirect 
            ? {
                ipaymu_trx_id: payment.transactionId,
                payment_no: payment.paymentNo,
                qr_content: payment.qrContent,
                payment_expired: payment.expired,
                payment_flow: "direct"
              }
            : {
                ipaymu_session_id: payment.sessionId,
                payment_url: payment.paymentUrl,
                payment_flow: "redirect"
              };

        await supabase.from("topup_orders").update(updatePayload).eq("id", orderId);

        notify("topup", `💎 Pesanan topup baru ${orderId}: ${product.nama} ke ${tujuan} senilai ${rupiahLog(total)}${appliedPromoCode ? ` (promo ${appliedPromoCode})` : ""}${konteksReseller.isReseller ? ` [reseller ${konteksReseller.tier.name} -${konteksReseller.discountPercent}%]` : ""}`);

        if (isDirect) {
            // Sama seperti di orderController: nominal yang ditampilkan harus
            // yang beneran ke-encode di QR/VA iPaymu (bisa termasuk fee kalau
            // dibebankan ke pembeli), bukan total polos.
            const displayAmount = payment.amount || (total + (payment.fee || 0));
            
            sendUserWhatsApp(normalizedPhone, "pending", { name: "Pelanggan", order_id: orderId, total: rupiahLog(displayAmount) });

            res.status(201).json({
                message: "Pesanan topup berhasil dibuat",
                orderId,
                reseller: konteksReseller.isReseller
                    ? { tier: konteksReseller.tier.name, persen: konteksReseller.discountPercent, harga_normal: hargaNormal, hemat: hematReseller }
                    : null,
                flow: "direct",
                paymentData: {
                    paymentNo: payment.paymentNo,
                    qrContent: payment.qrContent,
                    expired: payment.expired,
                    amount: displayAmount,
                    fee: payment.fee
                }
            });
        } else {
            sendUserWhatsApp(normalizedPhone, "pending", { name: "Pelanggan", order_id: orderId, total: rupiahLog(total) });

            res.status(201).json({
                message: "Pesanan topup berhasil dibuat",
                orderId,
                reseller: konteksReseller.isReseller
                    ? { tier: konteksReseller.tier.name, persen: konteksReseller.discountPercent, harga_normal: hargaNormal, hemat: hematReseller }
                    : null,
                flow: "redirect",
                paymentUrl: payment.paymentUrl
            });
        }
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server Error" });
    }
};

// ===========================================================
// PUBLIK — validasi kode promo dari halaman topup diamond (tombol
// "Terapkan"), mirror dari promoCodeController.validate tapi ambil harga
// dari tabel topup_products (bukan products biasa).
// ===========================================================
exports.validatePromo = async (req, res) => {
    const { code, kode_produk, email } = req.body;

    if (!kode_produk) {
        return res.status(400).json({ valid: false, message: "Produk belum dipilih" });
    }

    try {
        const { data: product, error: prodErr } = await supabase
            .from("topup_products")
            .select("kode_produk, harga_beli, harga_jual")
            .eq("kode_produk", kode_produk)
            .eq("is_active", true)
            .maybeSingle();

        if (prodErr || !product) {
            return res.status(404).json({ valid: false, message: "Produk topup tidak ditemukan" });
        }
        
        // DYNAMIC PRICING: if harga_jual is 0, calculate dynamically using backend markup rules.
        if (!product.harga_jual || product.harga_jual === 0) {
            product.harga_jual = hitungMarkupWajar(product.harga_beli || 0);
        }

        const cartItems = [{ id: product.kode_produk, price: product.harga_jual, quantity: 1 }];
        const result = await validatePromoCode(code, cartItems, email);
        if (!result.valid) {
            return res.status(400).json(result);
        }

        res.json({
            valid: true,
            code: result.promo.code,
            discount: result.discount,
            discount_type: result.promo.discount_type,
            discount_value: result.promo.discount_value,
            description: result.promo.description
        });
    } catch (err) {
        console.log(err);
        res.status(500).json({ valid: false, message: "Server Error" });
    }
};

// ===========================================================
// PUBLIK — cek status ringkas 1 order topup (dipakai halaman "kembali dari
// pembayaran" setelah redirect iPaymu; guest checkout gak punya token login).
// ===========================================================
exports.getPublicStatus = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("topup_orders")
            .select("id, status, harga, nama_produk, tujuan")
            .eq("id", req.params.id)
            .maybeSingle();

        if (error || !data) return res.status(404).json({ message: "Order tidak ditemukan" });
        res.json(data);
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

// Cek transaksi via ID — dipakai tab "Cek Transaksi" di web utama.
// Publik (tanpa authMiddleware) supaya guest checkout juga bisa cek, tapi
// gak balikin recipient_email/kode voucher penuh biar orang lain yang cuma
// nebak-nebak Order ID gak bisa lihat data sensitif punya orang lain.
exports.getPublicDetail = async (req, res) => {
    try {
        const { data: order, error } = await supabase
            .from("topup_orders")
            .select("id, status, harga, subtotal, discount_amount, promo_code, nama_produk, kode_produk, tujuan, server_id, payment_method, tv_sn, created_at, updated_at")
            .eq("id", req.params.id)
            .maybeSingle();

        if (error || !order) return res.status(404).json({ message: "Transaksi tidak ditemukan" });

        // Resolusi kategori NexShop produk ini (PLN/Pulsa/E-Wallet/dst) supaya
        // frontend "Cek Status Transaksi" bisa nampilin label field & instruksi
        // kode/SN yang SESUAI produknya -- bukan hardcode "User ID" buat semua
        // jenis produk kayak sebelumnya. resolveNexshopCategory & isPascabayarProduct
        // butuh baris topup_products + category map, jadi diambil di sini.
        let displayCategory = "Lainnya";
        let isPascabayar = false;
        if (order.kode_produk) {
            const [{ data: productRow }, categoryMap] = await Promise.all([
                supabase
                    .from("topup_products")
                    .select("kategori, source_category_id, source_category_name, manual_category_override")
                    .eq("kode_produk", order.kode_produk)
                    .maybeSingle(),
                loadCategoryMap()
            ]);
            if (productRow) {
                displayCategory = resolveNexshopCategory(productRow, categoryMap);
                isPascabayar = isPascabayarProduct(productRow);
            }
        }

        const targetMeta = getTargetFieldMeta(displayCategory, isPascabayar);
        const serialNumber = order.status === "sukses" ? order.tv_sn : null;

        // PLN Prabayar: SN-nya gabungan "<no token>/<keterangan pelanggan>" --
        // dipisah supaya nampil sebagai "No Token" + "Keterangan" terpisah,
        // bukan satu baris mentah yang bikin orang gak ngeh mana yang harus
        // dimasukin ke meteran.
        let tokenNumber = null;
        let tokenKeterangan = null;
        if (serialNumber && displayCategory.toLowerCase() === "pln" && !isPascabayar) {
            const parsed = parsePlnTokenSn(serialNumber);
            if (parsed) {
                tokenNumber = parsed.token;
                tokenKeterangan = parsed.keterangan || null;
            }
        }

        res.json({
            id: order.id,
            type: "topup",
            status: order.status,
            nama_produk: order.nama_produk,
            tujuan: order.tujuan,
            target_label: targetMeta.resultLabel,
            server_id: order.server_id,
            payment_method: order.payment_method,
            // SN cuma ditampilin kalau statusnya udah sukses
            serial_number: serialNumber,
            token_number: tokenNumber,
            token_keterangan: tokenKeterangan,
            serial_instruction: serialNumber ? getSerialInstruction(displayCategory, isPascabayar) : null,
            subtotal: order.subtotal || order.harga,
            discount_amount: order.discount_amount || 0,
            promo_code: order.promo_code || null,
            total: order.harga,
            created_at: order.created_at,
            updated_at: order.updated_at
        });
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server Error" });
    }
};

exports.getMyOrders = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("topup_orders")
            .select("*")
            .eq("user_id", req.user.id)
            .order("created_at", { ascending: false });

        if (error) return res.status(500).json({ message: "Database Error" });

        // FEATURE: sama seperti orderController.getMyOrders, sertakan flag
        // has_rating supaya "Riwayat Saya" bisa nampilin badge "Beri Rating"
        // untuk topup juga (lihat topup_ratings di ratingController.js).
        const successOrderIds = (data || [])
            .filter(o => o.status === "sukses")
            .map(o => o.id);

        let ratedOrderIds = new Set();
        if (successOrderIds.length > 0) {
            const { data: ratings, error: ratingErr } = await supabase
                .from("topup_ratings")
                .select("order_id")
                .in("order_id", successOrderIds);
            if (!ratingErr && ratings) {
                ratedOrderIds = new Set(ratings.map(r => r.order_id));
            }
            // Kalau tabel topup_ratings belum di-migrate (42P01) atau query
            // gagal karena sebab lain, jangan sampai gagalkan seluruh
            // riwayat topup -- cukup skip flag has_rating (frontend akan
            // treat sebagai unknown/tidak tampilkan badge untuk item itu).
        }

        const withRatingFlag = (data || []).map(o => ({
            ...o,
            has_rating: o.status === "sukses" ? ratedOrderIds.has(o.id) : null
        }));

        res.json(withRatingFlag);
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

// ADMIN — semua order topup, buat dashboard
exports.getAllOrders = async (req, res) => {
    if (!["admin", "staff"].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    try {
        const { data, error } = await supabase
            .from("topup_orders")
            .select("*")
            .order("created_at", { ascending: false });

        if (error) return res.status(500).json({ message: "Database Error" });
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

// Fulfill: dipanggil setelah pembayaran iPaymu "paid" — eksekusi transaksi
// nyata ke TokoVoucher supaya diamond benar-benar terkirim
async function fulfillOrder(order) {
    try {
        const result = await tokovoucher.createTransaction({
            refId: order.id,
            kodeProduk: order.kode_produk,
            tujuan: order.tujuan,
            serverId: order.server_id
        });

        // TokoVoucher mengembalikan status: 0 dan error_msg jika terjadi error (misal IP tidak diizinkan, saldo habis)
        let finalStatus = "processing";
        if (result.status === 0 || result.status === "0") finalStatus = "gagal";
        else finalStatus = TOKOVOUCHER_STATUS_MAP[result.status] || "processing";

        await supabase.from("topup_orders").update({
            status: finalStatus,
            tv_ref_id: result.ref_id || order.id,
            tv_trx_id: result.trx_id || null,
            tv_sn: result.sn || null,
            tv_message: result.error_msg || result.message || null,
            updated_at: new Date().toISOString()
        }).eq("id", order.id);

        // fulfillOrder cuma dipanggil sekali per order (dijaga idempotency di
        // caller lewat cek !order.tv_trx_id), jadi kalau langsung sukses di
        // sini, ini pasti transisi PERTAMA kali ke "sukses" — aman kirim invoice
        if (finalStatus === "sukses" && order.recipient_email) {
            try {
                await sendTopupInvoiceEmail(order.recipient_email, {
                    orderId: order.id,
                    namaProduk: order.nama_produk,
                    tujuan: order.tujuan,
                    serverId: order.server_id,
                    harga: order.harga,
                    serialNumber: result.sn || null
                });
            } catch (mailErr) {
                console.log("Gagal kirim invoice topup email:", mailErr.response?.data || mailErr.message);
            }
        }
        if (finalStatus === "sukses") {
            sendTelegramNotification(
                `💎 <b>Pembelian Topup Baru</b>\nOrder ID: ${order.id}\nProduk: ${order.nama_produk}\nTujuan: ${order.tujuan}${order.server_id ? ` (${order.server_id})` : ""}\nTotal: ${rupiahLog(order.harga)}`
            );
            sendWhatsAppNotification(
                `💎 *Pembelian Topup Baru*\nOrder ID: ${order.id}\nProduk: ${order.nama_produk}\nTujuan: ${order.tujuan}${order.server_id ? ` (${order.server_id})` : ""}\nTotal: ${rupiahLog(order.harga)}`
            );
            
            // Fonnte user WA delivery idempotency
            const { processNotificationEvent } = require('../services/notificationDeliveryService');
            processNotificationEvent(order.id, "success").catch(e => console.log("Gagal trigger notif WA Topup:", e));
        }
    } catch (err) {
        // Sesuai catatan TokoVoucher: HTTP error / timeout HARUS dianggap PENDING,
        // bukan gagal — jangan tandai gagal di sini, biarkan admin/webhook/polling
        // yang menentukan status final belakangan.
        console.log("TokoVoucher fulfill error (dianggap pending):", err.response?.data || err.message);
        await supabase.from("topup_orders").update({
            status: "processing",
            tv_message: "Menunggu konfirmasi TokoVoucher",
            updated_at: new Date().toISOString()
        }).eq("id", order.id);

        // Kalau errornya BUKAN error jaringan/HTTP biasa ke TokoVoucher
        // (misal bug kode kayak "statusMap is not defined" yang sempet
        // kejadian), langsung kabarin admin -- soalnya kalau ini bug beneran,
        // order bisa nyangkut lama di "processing" walau diamond-nya udah
        // kekirim, dan gak akan kelihatan sampai poller jalan 5-10 menit lagi.
        if (!err.response && !err.request && err.code !== "ECONNABORTED") {
            notify("security", `⚠️ Error internal (bukan error jaringan TokoVoucher) saat fulfill topup ${order.id}: ${err.message}. Cek log server & status order ini manual.`);
        }
    }
}

// ===========================================================
// WEBHOOK — notifikasi pembayaran iPaymu. SENGAJA tanpa authMiddleware,
// yang memanggil adalah server iPaymu; keasliannya diverifikasi dengan
// mengecek ULANG status transaksi langsung ke server iPaymu (server-to-server).
// ===========================================================
exports.handleIpaymuNotification = async (req, res) => {
    try {
        const body = req.body || {};
        const orderId = body.reference_id || body.referenceId;
        const trxId = body.trx_id || body.trxId;

        if (!orderId) {
            return res.status(400).json({ message: "reference_id tidak ada di body notifikasi" });
        }

        const { data: order } = await supabase
            .from("topup_orders")
            .select("*")
            .eq("id", orderId)
            .maybeSingle();

        if (!order) {
            return res.status(404).json({ message: "Order topup tidak ditemukan" });
        }

        // Verifikasi ulang ke server iPaymu — JANGAN PERNAH percaya status dari
        // body webhook begitu saja (endpoint ini publik; kalau dipercaya
        // mentah-mentah, siapapun yang tahu URL-nya bisa klaim "berhasil" dan
        // dapat diamond gratis tanpa bayar). Kalau verifikasi ke iPaymu gagal
        // (trx_id gak ada / gak valid / iPaymu error), order TIDAK diubah
        // statusnya dan TIDAK di-fulfill — dicatat ke notifikasi admin buat
        // dicek manual. iPaymu otomatis retry webhook kalau gagal.
        let verifiedStatus = null;
        if (trxId) {
            try {
                const trx = await checkTransactionStatus(trxId);
                verifiedStatus = String(trx.Status || trx.status || "").toLowerCase();
            } catch (verifyErr) {
                console.log("Gagal verifikasi status ke iPaymu:", verifyErr.message);
            }
        }

        if (verifiedStatus === null) {
            notify("security", `⚠️ Notifikasi pembayaran topup ${orderId} gak bisa diverifikasi ke iPaymu (trx_id: ${trxId || "-"}). Status order TIDAK diubah, cek manual di dashboard iPaymu.`);
            return res.status(200).json({ message: "Diterima, menunggu verifikasi" });
        }

        let status = order.status;
        let shouldFulfill = false;

        if (["berhasil", "success", "1", "paid", "settlement"].includes(verifiedStatus)) {
            status = "processing"; // Setelah iPaymu sukses, masuk processing sebelum/saat Tokovoucher dikontak
            shouldFulfill = true;
        } else if (["pending", "0"].includes(verifiedStatus)) {
            status = "pending";
        } else if (["gagal", "expired", "cancel", "cancelled", "-1", "failed", "expire"].includes(verifiedStatus)) {
            status = "failed";
        }

        // Tegakkan status monotonik topup
        if (order.status === "sukses" && status !== "sukses") {
            return res.status(200).json({ message: "OK (Ignored downgrade from sukses)" });
        }
        if (order.status === "processing" && status === "pending") {
            return res.status(200).json({ message: "OK (Ignored downgrade from processing to pending)" });
        }

        // Kueri kondisional untuk mencegah menimpa status yang lebih maju secara race condition
        let query = supabase.from("topup_orders").update({
            status,
            payment_status: verifiedStatus,
            updated_at: new Date().toISOString()
        }).eq("id", orderId);

        if (status !== "sukses") {
            query = query.neq("status", "sukses");
        }
        if (status === "pending") {
            query = query.neq("status", "processing");
        }

        // Prevent transitioning to processing if it's already processing or sukses
        if (status === "processing") {
            query = query.in("status", ["pending", "failed"]);
        }

        const { data: updatedRows, error } = await query.select();
        
        if (error) {
            console.log(error);
            return res.status(500).json({ message: "Gagal update status pesanan" });
        }

        if (!updatedRows || updatedRows.length === 0) {
            return res.status(200).json({ message: "OK (No status transition made)" });
        }

        // catat pemakaian kode promo cuma sekali, pas transisi PERTAMA KALI ke "processing" (artinya udah lunas iPaymu)
        if (status === "processing" && order.promo_code) {
            await incrementUsage(order.promo_code, order.recipient_email, orderId);
        }

        // baru eksekusi topup ke TokoVoucher KALAU pembayaran baru saja lunas
        // dan belum pernah diproses sebelumnya (idempotency check via tv_trx_id)
        if (shouldFulfill && !order.tv_trx_id) {
            await fulfillOrder({ ...order, status });
        }

        res.status(200).json({ message: "OK" });
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: err.message || "Server Error" });
    }
};

// ===========================================================
// WEBHOOK — laporan status final dari TokoVoucher sendiri (kalau transaksi
// sempat PENDING lalu statusnya berubah di sisi mereka). Divalidasi via
// header X-TokoVoucher-Authorization, BUKAN authMiddleware biasa.
// ===========================================================
// Terapkan hasil status dari TokoVoucher (baik dari webhook, cek status
// manual di admin, maupun poller otomatis) ke SATU order topup: update DB,
// kirim invoice + notif Telegram HANYA pas transisi PERTAMA KALI ke "sukses"
// (biar gak dobel kalau TokoVoucher retry webhook atau poller ngecek ulang).
// `result` bentuknya sama persis baik dari payload webhook maupun response
// checkStatus() -- field: status, message, sn, trx_id.
async function reconcileTopupOrder(order, result) {
    let finalStatus = "processing";
    if (result.status === 0 || result.status === "0") finalStatus = "gagal";
    else finalStatus = TOKOVOUCHER_STATUS_MAP[result.status] || "processing";
    
    const wasNotYetSukses = order.status !== "sukses";

    // Monotonic Check untuk Tokovoucher Webhook / Reconcile
    if (order.status === "sukses" && finalStatus !== "sukses") {
        return order.status; // Ignore downgrade
    }

    let query = supabase.from("topup_orders").update({
        status: finalStatus,
        tv_trx_id: result.trx_id || order.tv_trx_id || null,
        tv_sn: result.sn || order.tv_sn || null,
        tv_message: result.error_msg || result.message || order.tv_message || null,
        updated_at: new Date().toISOString()
    }).eq("id", order.id);

    // Apapun finalStatus-nya, order yang statusnya udah "sukses" gak boleh
    // ditimpa lagi (baik downgrade maupun re-konfirmasi "sukses" ganda dari
    // webhook TokoVoucher yang retry / poller yang overlap) -- biar invoice
    // & notifikasi di bawah gak kekirim dobel.
    query = query.neq("status", "sukses");

    const { data: updatedRows, error } = await query.select();
    if (error) {
        console.log("Gagal update status topup_orders:", error);
        return finalStatus;
    }

    // if no rows were updated, it means another process already transitioned it,
    // or the state was already finalStatus.
    if (!updatedRows || updatedRows.length === 0) {
        return finalStatus;
    }

    if (finalStatus === "sukses" && order.recipient_email) {
        try {
            await sendTopupInvoiceEmail(order.recipient_email, {
                orderId: order.id,
                namaProduk: order.nama_produk,
                tujuan: order.tujuan,
                serverId: order.server_id,
                harga: order.harga,
                serialNumber: result.sn || order.tv_sn || null
            });
        } catch (mailErr) {
            console.log("Gagal kirim invoice topup email:", mailErr.response?.data || mailErr.message);
        }
    }
    if (finalStatus === "sukses") {
        sendTelegramNotification(
            `💎 <b>Pembelian Topup Baru</b>\nOrder ID: ${order.id}\nProduk: ${order.nama_produk}\nTujuan: ${order.tujuan}${order.server_id ? ` (${order.server_id})` : ""}\nTotal: ${rupiahLog(order.harga)}`
        );
        sendWhatsAppNotification(
            `💎 *Pembelian Topup Baru*\nOrder ID: ${order.id}\nProduk: ${order.nama_produk}\nTujuan: ${order.tujuan}${order.server_id ? ` (${order.server_id})` : ""}\nTotal: ${rupiahLog(order.harga)}`
        );
        
        // Fonnte user WA delivery idempotency
        const { processNotificationEvent } = require('../services/notificationDeliveryService');
        processNotificationEvent(order.id, "success").catch(e => console.log("Gagal trigger notif WA Topup:", e));
    }

    return finalStatus;
}

exports.handleTokoVoucherWebhook = async (req, res) => {
    try {
        const body = req.body;
        const refId = body.ref_id;
        const headerSig = req.headers["x-tokovoucher-authorization"];

        const valid = await tokovoucher.verifyWebhookSignature(headerSig, refId);
        if (!valid) {
            return res.status(401).json({ message: "Signature tidak valid" });
        }

        const { data: existingOrder } = await supabase
            .from("topup_orders")
            .select("id, status, recipient_email, nama_produk, tujuan, server_id, harga, tv_trx_id, tv_sn, tv_message")
            .eq("id", refId)
            .maybeSingle();

        if (!existingOrder) {
            // order gak ketemu (ref_id aneh / order lama yg udah dihapus) --
            // tetep balikin 200 biar TokoVoucher gak retry-retry terus.
            return res.status(200).json({ message: "OK (order tidak ditemukan, diabaikan)" });
        }

        await reconcileTopupOrder(existingOrder, body);
        res.status(200).json({ message: "OK" });
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server Error" });
    }
};

// Cek status manual (admin retry / user polling) langsung ke TokoVoucher
exports.checkStatus = async (req, res) => {
    const { id } = req.params;
    try {
        const { data: order } = await supabase.from("topup_orders").select("*").eq("id", id).maybeSingle();
        if (!order) return res.status(404).json({ message: "Order tidak ditemukan" });

        const result = await tokovoucher.checkStatus(id);
        await reconcileTopupOrder(order, result);

        res.json(result);
    } catch (err) {
        console.log(err.response?.data || err.message);
        res.status(500).json({ message: "Gagal cek status ke TokoVoucher" });
    }
};

// ===========================================================
// FALLBACK OTOMATIS -- dipanggil berkala oleh jobs/topupStatusPoller.js.
// TokoVoucher nyaranin polling tiap ~10 menit sebagai cadangan kalau-kalau
// webhook mereka gak sempet nyampe (server down bentar, whitelist kespotong
// sementara, dll) -- soalnya sebelum ini order bisa nyangkut di "processing"
// selama-lamanya kalau gak ada admin yang manual klik "Cek Status".
//
// Cuma nyentuh order yang statusnya "processing" (= udah kekirim ke
// TokoVoucher, lagi nunggu report final -- order "pending"/belum-bayar
// gak ikut dicek), DAN udah lewat dari STUCK_AFTER_MINUTES sejak terakhir
// diupdate (biar gak ganggu order yg emang masih baru diproses TokoVoucher),
// DAN dibuat gak lebih dari MAX_AGE_HOURS yang lalu (order yg beneran
// ilang/dibiarin lama gak perlu terus dicek tiap 10 menit selamanya).
const STUCK_AFTER_MINUTES = 5;
const MAX_AGE_HOURS = 48;

exports.pollStuckOrders = async () => {
    const oldestAllowed = new Date(Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();
    const lockToken = require('crypto').randomUUID();

    // 1. Recover stale locks
    const fiveMinsAgo = new Date(Date.now() - 5 * 60000).toISOString();
    await supabase.from("topup_orders")
        .update({ locked_at: null, lock_token: null })
        .eq("status", "processing")
        .lt("locked_at", fiveMinsAgo);

    // 2. Fetch candidates (where next_status_check_at is null or past)
    const { data: candidates, error } = await supabase
        .from("topup_orders")
        .select("id")
        .eq("status", "processing")
        .gt("created_at", oldestAllowed)
        .or(`next_status_check_at.is.null,next_status_check_at.lte.${now}`)
        .limit(10);

    if (error || !candidates || !candidates.length) return;

    for (const candidate of candidates) {
        // Atomic Claim
        const { data: order, error: claimErr } = await supabase
            .from("topup_orders")
            .update({
                locked_at: now,
                lock_token: lockToken
            })
            .eq("id", candidate.id)
            .eq("status", "processing")
            .is("locked_at", null) // ensure no one else claimed it since we fetched
            .select()
            .single();

        if (claimErr || !order) continue; // Someone else claimed it

        try {
            const result = await tokovoucher.checkStatus(order.id);
            const finalStatus = await reconcileTopupOrder(order, result);

            if (finalStatus === "processing") {
                await supabase.from("topup_orders").update({
                    locked_at: null,
                    lock_token: null,
                    next_status_check_at: new Date(Date.now() + 10 * 60000).toISOString()
                }).eq("id", order.id).eq("lock_token", lockToken);
            } else {
                await supabase.from("topup_orders").update({
                    locked_at: null,
                    lock_token: null,
                    next_status_check_at: null
                }).eq("id", order.id).eq("lock_token", lockToken);
            }
        } catch (checkErr) {
            console.log(`[topup-poller] error ngecek ${order.id}:`, checkErr.message);
            await supabase.from("topup_orders").update({
                locked_at: null,
                lock_token: null,
                next_status_check_at: new Date(Date.now() + 5 * 60000).toISOString()
            }).eq("id", order.id).eq("lock_token", lockToken);
        }
        await new Promise((r) => setTimeout(r, 800));
    }
};

// ADMIN — cek saldo akun TokoVoucher (dipakai di Settings/Topup dashboard)
exports.getBalance = async (req, res) => {
    if (!["admin", "staff"].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    try {
        const result = await tokovoucher.checkBalance();
        res.json(result);
    } catch (err) {
        console.log(err.response?.data || err.message);
        res.status(500).json({ message: "Gagal cek saldo TokoVoucher" });
    }
};

// ==========================================
// NEW CATALOG SYNC & MANAGEMENT
// ==========================================

exports.syncFullCatalog = async (req, res) => {
    if (!["admin"].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    try {
        // Run sync asynchronously so it doesn't block the request if it takes long
        // But for a simple approach, we can await it or return immediately.
        // Let's await it. The admin can wait or we can use SSE later if needed.
        const result = await catalogService.syncFullCatalog('manual');
        res.json({ message: "Sync berhasil dimulai", ...result });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: err.message || "Gagal sinkronisasi katalog" });
    }
};

exports.getSyncStatus = async (req, res) => {
    if (!["admin", "staff"].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    try {
        const status = catalogService.getSyncStatus();
        const { data } = await supabase.from("catalog_sync_log").select("*").order("started_at", { ascending: false }).limit(1).maybeSingle();
        res.json({ is_running: status.is_running, last_log: data || null });
    } catch (err) {
        res.status(500).json({ message: "Gagal memuat status sync" });
    }
};

exports.getCatalogSummary = async (req, res) => {
    if (!["admin", "staff"].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    try {
        // .maybeSingle() (bukan .single()) — katalog yang belum pernah
        // di-sync sama sekali punya 0 baris log, dan .single() nganggep itu
        // error PGRST116 yang bikin seluruh ringkasan gagal dimuat.
        const { data: syncLog } = await supabase
            .from("catalog_sync_log")
            .select("*")
            .order("started_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        // loadAdminCatalog() udah paginasi + resolve kategori/operator, jadi
        // ringkasan ini PASTI konsisten sama isi tabel produk di sebelahnya.
        const products = await loadAdminCatalog(
            "id, nama, kode_produk, kategori, source_category_name, source_operator_id, source_operator_name, source_status, is_active, auto_managed, manual_category_override"
        );

        const globalStats = { total: products.length, active: 0, inactive: 0, foreign: 0 };
        const summary = {};

        products.forEach((p) => {
            const isForeign = p.source_status && p.source_status !== "active";
            if (isForeign) globalStats.foreign++;
            else if (p.is_active) globalStats.active++;
            else globalStats.inactive++;

            const cat = p.nexshop_category;
            if (!summary[cat]) summary[cat] = { total: 0, active: 0, operators: {} };

            const catEntry = summary[cat];
            catEntry.total++;
            if (!isForeign && p.is_active) catEntry.active++;

            if (!catEntry.operators[p.operator_id]) {
                catEntry.operators[p.operator_id] = {
                    name: p.operator_name,
                    source_category_id: p.source_category_id || null,
                    source_operator_id: p.source_operator_id || null,
                    legacy_kategori: p.source_operator_id ? null : p.kategori || null,
                    total: 0,
                    active: 0,
                    inactive: 0,
                    auto_managed_true: 0,
                    auto_managed_false: 0,
                    foreign: 0
                };
            }

            const opObj = catEntry.operators[p.operator_id];
            opObj.total++;

            if (isForeign) {
                opObj.foreign++;
            } else {
                if (p.is_active) opObj.active++;
                else opObj.inactive++;

                if (p.auto_managed) opObj.auto_managed_true++;
                else opObj.auto_managed_false++;
            }
        });

        // Tentuin state MIXED/ON/OFF per operator
        for (const cat in summary) {
            for (const opId in summary[cat].operators) {
                const op = summary[cat].operators[opId];
                const eligible = op.total - op.foreign;
                if (eligible === 0 || op.active === 0) op.state = "OFF";
                else if (op.active === eligible) op.state = "ON";
                else op.state = "MIXED";
            }
        }

        res.json({ current: globalStats, sync: syncLog || null, categories: summary });
    } catch (err) {
        console.error("getCatalogSummary:", err.message);
        res.status(500).json({ message: "Gagal memuat ringkasan katalog" });
    }
};

exports.toggleOperator = async (req, res) => {
    if (!["admin"].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    try {
        const { source_category_id, source_operator_id, legacy_name, legacy_kategori, active } = req.body;
        if (typeof active !== "boolean") {
            return res.status(400).json({ message: "Field active wajib boolean" });
        }

        const applyFilter = (query) => {
            if (source_operator_id) {
                query = query.eq("source_operator_id", source_operator_id);
                if (source_category_id) query = query.eq("source_category_id", source_category_id);
                return query;
            }
            // Produk lama tanpa source_operator_id cuma bisa diidentifikasi
            // lewat kolom kategori-nya.
            return query.is("source_operator_id", null).eq("kategori", legacy_kategori || legacy_name);
        };

        if (!source_operator_id && !legacy_kategori && !legacy_name) {
            return res.status(400).json({ message: "Identitas operator gak lengkap buat bulk toggle" });
        }

        // Paginasi -- operator besar (mis. Mobile Legends) gampang lewat 1000
        // produk, dan tanpa ini sisanya diam-diam gak ikut keubah.
        const products = await fetchAllRows((from, to) =>
            applyFilter(supabase.from("topup_products").select("id, is_active, auto_managed, source_status, harga_beli, harga_jual")).range(from, to)
        );

        let protectedCount = 0;
        let foreignCount = 0;
        const toUpdate = [];

        products.forEach((p) => {
            if (p.source_status && p.source_status !== "active") {
                foreignCount++;
                return;
            }
            if (!p.auto_managed) {
                protectedCount++;
                return;
            }
            if (p.is_active !== active) toUpdate.push(p);
        });

        if (toUpdate.length === 0) {
            return res.json({ message: `Selesai. 0 diubah (Dilindungi: ${protectedCount}, Foreign: ${foreignCount})`, changed: 0 });
        }

        // Produk yang harga jualnya masih 0 gak boleh tayang di toko -- isi
        // otomatis pakai markup wajar biar gak kejual rugi.
        const needsPrice = active ? toUpdate.filter((p) => !p.harga_jual || Number(p.harga_jual) <= 0) : [];
        const plain = toUpdate.filter((p) => !needsPrice.includes(p));

        const chunkSize = 200;
        async function bulkUpdate(rows, payloadFor) {
            const groups = new Map();
            rows.forEach((p) => {
                const key = JSON.stringify(payloadFor(p));
                if (!groups.has(key)) groups.set(key, { payload: payloadFor(p), ids: [] });
                groups.get(key).ids.push(p.id);
            });
            for (const { payload, ids } of groups.values()) {
                for (let i = 0; i < ids.length; i += chunkSize) {
                    const { error } = await supabase
                        .from("topup_products")
                        .update({ ...payload, updated_at: new Date().toISOString() })
                        .in("id", ids.slice(i, i + chunkSize));
                    if (error) throw error;
                }
            }
        }

        await bulkUpdate(plain, () => ({ is_active: active }));
        await bulkUpdate(needsPrice, (p) => ({ is_active: active, harga_jual: hitungMarkupWajar(p.harga_beli || 0) }));

        notify("product", `${active ? "OK" : "OFF"} ${req.user.email} ${active ? "mengaktifkan" : "menonaktifkan"} ${toUpdate.length} produk operator "${legacy_name || source_operator_id}"`);
        res.json({
            message: `Berhasil mengubah ${toUpdate.length} produk jadi ${active ? "Aktif" : "Nonaktif"}. (Dilindungi: ${protectedCount}, Diabaikan: ${foreignCount})`,
            changed: toUpdate.length
        });
    } catch (err) {
        console.error("toggleOperator:", err.message);
        res.status(500).json({ message: "Gagal memproses bulk toggle" });
    }
};

// ADMIN -- terapin satu aksi ke SEMUA produk yang cocok sama filter yang
// lagi aktif di dashboard (kategori + operator + status + kata kunci),
// tanpa admin harus nyentang 11.000 checkbox satu-satu.
//
// Ini inti dari "setup produk gampang": pilih kategori -> klik sekali ->
// selesai. Produk yang statusnya udah di-override manual sama admin
// (auto_managed = false) TETAP dilindungi buat aksi aktivasi.
const FILTER_ACTIONS = new Set(["activate", "deactivate", "auto-markup", "server-id-on", "server-id-off"]);

exports.applyToFilter = async (req, res) => {
    if (!["admin", "staff"].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }

    const { action } = req.body || {};
    if (!FILTER_ACTIONS.has(action)) {
        return res.status(400).json({ message: "Aksi tidak dikenal" });
    }

    try {
        const filter = req.body.filter || {};
        const category = String(filter.category || "").trim();
        const operator = String(filter.operator || "").trim();
        const status = String(filter.status || "").trim();
        const q = String(filter.q || "").trim().toLowerCase();

        if (!category && !operator && !q && !status) {
            return res.status(400).json({ message: "Pilih minimal satu filter dulu supaya aksinya gak kena ke seluruh katalog" });
        }

        const catalog = await loadAdminCatalog(
            "id, nama, kode_produk, kategori, source_category_name, source_operator_id, source_operator_name, source_status, is_active, auto_managed, manual_category_override, harga_beli, harga_jual, butuh_server_id"
        );

        let list = catalog.filter((p) => !(p.source_status && p.source_status !== "active"));
        if (category) list = list.filter((p) => p.nexshop_category === category);
        if (operator) list = list.filter((p) => p.operator_id === operator);
        if (status === "active") list = list.filter((p) => !!p.is_active);
        if (status === "inactive") list = list.filter((p) => !p.is_active);
        if (q) {
            list = list.filter(
                (p) =>
                    String(p.nama || "").toLowerCase().includes(q) ||
                    String(p.kode_produk || "").toLowerCase().includes(q)
            );
        }

        if (list.length === 0) {
            return res.json({ message: "Gak ada produk yang cocok sama filter ini", changed: 0, matched: 0 });
        }

        let protectedCount = 0;
        let changed = 0;
        const chunkSize = 200;

        // Kelompokin baris yang payload-nya sama biar 1 query per grup,
        // bukan 1 query per produk.
        async function updateInChunks(rows, payloadFor) {
            const groups = new Map();
            rows.forEach((p) => {
                const payload = payloadFor(p);
                if (!payload) return;
                const key = JSON.stringify(payload);
                if (!groups.has(key)) groups.set(key, { payload, ids: [] });
                groups.get(key).ids.push(p.id);
            });

            for (const { payload, ids } of groups.values()) {
                for (let i = 0; i < ids.length; i += chunkSize) {
                    const { error } = await supabase
                        .from("topup_products")
                        .update({ ...payload, updated_at: new Date().toISOString() })
                        .in("id", ids.slice(i, i + chunkSize));
                    if (error) throw error;
                }
                changed += ids.length;
            }
        }

        if (action === "activate" || action === "deactivate") {
            const active = action === "activate";
            const eligible = list.filter((p) => {
                if (p.is_active === active) return false;
                if (!p.auto_managed) {
                    protectedCount++;
                    return false;
                }
                return true;
            });

            await updateInChunks(eligible, (p) => {
                const payload = { is_active: active };
                if (active && (!p.harga_jual || Number(p.harga_jual) <= 0)) {
                    payload.harga_jual = hitungMarkupWajar(p.harga_beli || 0);
                }
                return payload;
            });
        } else if (action === "auto-markup") {
            await updateInChunks(list, (p) => {
                const target = hitungMarkupWajar(p.harga_beli || 0);
                return Number(p.harga_jual) === target ? null : { harga_jual: target };
            });
        } else {
            const wanted = action === "server-id-on";
            await updateInChunks(
                list.filter((p) => !!p.butuh_server_id !== wanted),
                () => ({ butuh_server_id: wanted })
            );
        }

        const labels = {
            activate: "diaktifkan",
            deactivate: "dinonaktifkan",
            "auto-markup": "dihitung ulang harga jualnya",
            "server-id-on": "ditandai butuh Server ID",
            "server-id-off": "ditandai tanpa Server ID"
        };

        notify("product", `${req.user.email} menerapkan "${action}" ke ${changed} produk topup (filter: ${category || "semua"}${operator ? " / " + operator : ""})`);
        res.json({
            message: `${changed} produk ${labels[action]}.${protectedCount ? ` ${protectedCount} produk dilindungi (override manual).` : ""}${changed === 0 ? " Semuanya sudah sesuai." : ""}`,
            changed,
            protected: protectedCount,
            matched: list.length
        });
    } catch (err) {
        console.error("applyToFilter:", err.message);
        res.status(500).json({ message: "Gagal menerapkan aksi massal" });
    }
};

exports.getCategoryMap = async (req, res) => {
    if (!["admin", "staff"].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    try {
        const { data } = await supabase.from("topup_category_map").select("*").order("tokovoucher_category_name", { ascending: true });
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ message: "Gagal memuat map kategori" });
    }
};

exports.updateCategoryMap = async (req, res) => {
    if (!["admin"].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    try {
        const { tokovoucher_category_name, nexshop_category_name } = req.body;
        if (!tokovoucher_category_name || !nexshop_category_name) {
            return res.status(400).json({ message: "Data tidak lengkap" });
        }
        
        const { error } = await supabase.from("topup_category_map").upsert({
            tokovoucher_category_name,
            nexshop_category_name,
            updated_at: new Date().toISOString()
        }, { onConflict: "tokovoucher_category_name" });
        
        if (error) throw error;
        res.json({ message: "Mapping berhasil diubah" });
    } catch (err) {
        res.status(500).json({ message: "Gagal mengubah mapping" });
    }
};

exports.setOperatorActive = async (req, res) => {
    if (!["admin"].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    try {
        const { operator_name, is_active } = req.body;
        if (!operator_name || typeof is_active !== "boolean") {
            return res.status(400).json({ message: "Data tidak lengkap" });
        }
        
        const { error } = await supabase.from("topup_products")
            .update({ is_active })
            .eq("source_operator_name", operator_name);
            
        if (error) throw error;
        res.json({ message: `Semua produk untuk operator ${operator_name} berhasil ${is_active ? 'diaktifkan' : 'dinonaktifkan'}` });
    } catch (err) {
        res.status(500).json({ message: "Gagal mengubah status operator" });
    }
};

// --- Normalization Helpers for Public Catalog ---
function cleanProductName(name) {
    if (!name) return "";
    let cleaned = name;
    
    // Example: MLBB-ID-86-DM -> 86 Diamonds
    const mlMatch = cleaned.match(/^MLBB-ID-(\d+)-DM$/i);
    if (mlMatch) {
        return `${mlMatch[1]} Diamonds`;
    }
    
    // Clean up typical unambiguous suffixes/prefixes
    cleaned = cleaned.replace(/\(Promo\)/gi, "").trim();
    cleaned = cleaned.replace(/\[Promo\]/gi, "").trim();
    cleaned = cleaned.replace(/\s+/g, " ");
    return cleaned;
}

exports.getPublicCatalog = async (req, res) => {
    try {
        // Sama seperti getProducts: reseller yang login lihat harga miliknya.
        const konteksReseller = await getResellerContext(req.user && req.user.id);
        // Kita filter kategori "Gaming" di database agar tidak memakan limit 1000 baris.
        // Produk yang ada override manual dengan kategori selain Gaming tetap akan termuat.
        let allData = [];
        let page = 0;
        const pageSize = 1000;
        
        while (true) {
            const { data, error } = await supabase.from("topup_products")
                .select("id, nama, kode_produk, kategori, source_category_id, source_category_name, source_operator_id, source_operator_name, harga_beli, harga_jual, butuh_server_id, source_status, operator_logo, item_icon, manual_category_override, manual_name_override")
                .eq("is_active", true)
                .neq("kategori", "Gaming")
                .order("kategori")
                .order("harga_jual")
                .range(page * pageSize, (page + 1) * pageSize - 1);
            if (error) throw error;
            
            if (!data || data.length === 0) break;
            
            // DYNAMIC PRICING: if harga_jual is 0, calculate dynamically using backend markup rules.
            data.forEach(p => {
                if (!p.harga_jual || p.harga_jual === 0) {
                    p.harga_jual = hitungMarkupWajar(p.harga_beli || 0);
                }
            });
            
            terapkanHargaReseller(data, konteksReseller);

            allData.push(...data);
            if (data.length < pageSize) break;
            page++;
        }
        
        const data = allData;
        
        // Fetch category map
        const { data: mapData, error: mapErr } = await supabase.from("topup_category_map").select("*");
        const categoryMap = new Map();
        if (!mapErr && mapData) {
            mapData.forEach(m => categoryMap.set(m.tokovoucher_category_name, m.nexshop_category_name));
        }
        
        // Group by mapped category -> distinct operator -> products
        const catalogMap = new Map();
        
        data.forEach(p => {
            if (p.source_status && p.source_status !== 'active') return;
            delete p.source_status; // Security: hide internal status
            
            // Category Mapping Logic (Priority: manual override -> category map -> safe fallback)
            let displayCategory = "Lainnya";
            if (p.manual_category_override) {
                displayCategory = p.kategori || "Lainnya";
            } else if (p.source_category_name && categoryMap.has(p.source_category_name)) {
                displayCategory = categoryMap.get(p.source_category_name);
            } else if (categoryMap.has(p.kategori)) {
                displayCategory = categoryMap.get(p.kategori);
            } else {
                displayCategory = "Lainnya";
            }

            // Katalog ini KHUSUS feed Marketplace/One Stop Solution (PPOB:
            // pulsa, data, e-wallet, PLN, tagihan). Produk game punya
            // etalase sendiri di Topup Diamond (lihat getProducts).
            //
            // Dulu di sini cuma dicek isTopupGameCategory(displayCategory)
            // yang caranya cuma kenal satu nama kategori ("Gaming"), jadi
            // produk yang kategorinya kebaca "Topup Game"/"Voucher Game"
            // (tergantung mapping admin & fallback DEFAULT_CATEGORY_MAP)
            // tetap lolos dan nyasar ke Marketplace.
            if (isGameProduct(p, displayCategory)) return;

            // Buang SKU utilitas "Cek Nama/ID/Nickname/..." (lihat
            // isCheckerUtilityProduct di topupHelpers.js) -- SKU ini API
            // verifikasi akun TokoVoucher, bukan produk jualan beneran,
            // tapi bisa nongol di sini kalau kelanjur ke-aktifin (baris
            // lama di DB atau ke-aktifin gak sengaja lewat bulk-activate).
            if (isCheckerUtilityProduct(p.nama)) return;
            
            // Operator Mapping Logic (Use explicit operator name, fallback to legacy kategori)
            const displayOperator = p.source_operator_name || p.kategori || "Unknown";
            const operatorId = p.source_operator_id || displayOperator;
            
            // If there's a manual_name_override, we shouldn't "clean" it. Otherwise apply standard cleaning.
            // manual_name_override itu FLAG boolean (lihat migration 007),
            // bukan nama penggantinya. Sebelumnya p.nama di-set ke nilai
            // boolean-nya, jadi produk yang namanya diubah admin nongol
            // sebagai "true" di halaman toko.
            if (!p.manual_name_override) {
                p.nama = cleanProductName(p.nama);
            }
            
            // Produk pascabayar dapet flag "cek_tagihan" biar frontend bisa
            // nampilin tombol Cek Tagihan. Yang dikirim cuma boolean-nya --
            // id/nama kategori asli TokoVoucher tetap disembunyiin dari client.
            p.cek_tagihan = isPascabayarProduct(p);

            // Cleanup unnecessary fields from payload
            delete p.harga_beli; // harga modal = margin internal, jangan pernah keluar ke client
            delete p.manual_category_override;
            delete p.manual_name_override;
            delete p.source_category_id;
            delete p.source_category_name;
            delete p.source_operator_name;
            delete p.source_operator_id;
            
            const opLogo = p.operator_logo;
            delete p.operator_logo; 

            if (!catalogMap.has(displayCategory)) {
                catalogMap.set(displayCategory, new Map());
            }
            
            const opMap = catalogMap.get(displayCategory);
            if (!opMap.has(operatorId)) {
                opMap.set(operatorId, {
                    id: operatorId,
                    operator: displayOperator,
                    operator_logo: opLogo || null,
                    products: []
                });
            }
            
            opMap.get(operatorId).products.push(p);
        });
        
        // Convert Maps to Arrays
        const catalog = Array.from(catalogMap.entries()).map(([category, opMap]) => {
            return {
                category,
                operators: Array.from(opMap.values())
            };
        });
        
        res.json(catalog);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Gagal memuat katalog publik" });
    }
};
