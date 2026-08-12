const supabase = require("../config/db");
const crypto = require("crypto");
const tokovoucher = require("../config/tokovoucher");
const { createRedirectPayment, checkTransactionStatus, createDirectPayment, isDirectPaymentMethod } = require("../config/ipaymu");

const { checkNickname } = require("../config/apigames");
const { notify } = require("../config/notify");
const { sendUserWhatsApp } = require("../services/userWhatsAppService");
const { sendTopupInvoiceEmail } = require("../config/mailer");
const { sendTelegramNotification } = require("../config/telegram");
const { sendWhatsAppNotification } = require("../config/whatsapp");
const { validatePromoCode, incrementUsage } = require("./promoCodeController");
const { buildDiscountedIpaymuItems } = require("../utils/promoDiscountSplit");

const IPAYMU_PAYMENT_METHODS = Object.freeze({
    qris: "qris",
    va: "va",
    banktransfer: "banktransfer",
    card: "cc"
});

const FRONTEND_URL = (process.env.FRONTEND_URL || "").replace(/\/$/, "");
const BACKEND_URL = (process.env.BACKEND_URL || "").replace(/\/$/, "");

function rupiahLog(n) {
    return "Rp" + Number(n).toLocaleString("id-ID");
}

// ===========================================================
// Bulatkan ke ATAS ke kelipatan `round` terdekat. Pakai epsilon kecil
// sebelum Math.ceil supaya noise floating-point JS (mis. 5000*1.2 yang
// harusnya persis 6000 tapi kekomputasi 6000.000000000001) gak bikin
// harga kebulet naik satu kelipatan penuh secara gak sengaja.
// ===========================================================
function bulatkanKeAtas(nilai, round) {
    if (!round || round <= 0) return Math.round(nilai);
    const EPS = 1e-6;
    return Math.ceil(nilai / round - EPS) * round;
}

// ===========================================================
// Tabel markup "wajar" berdasarkan besaran harga modal — dipakai buat
// auto-markup (tombol "Markup Otomatis" di dashboard, dan default harga
// produk BARU pas sync). Logikanya: modal kecil (misal diamond receh)
// untungnya tipis kalau persennya kecil, jadi persennya digedein; modal
// gede persennya dikecilin biar harga jual tetap kompetitif/gak aneh.
// Urutan HARUS dari `max` terkecil ke terbesar. Angka % & batasnya bebas
// disesuaikan sama strategi margin toko.
//
// RISET HARGA REFERENSI (3 toko ML yang cukup murah & terkenal — dicek
// langsung dari screenshot harga toko, bukan cuma estimasi):
//   nominal kecil (5-74 dm)    -> margin riil tipis banget vs modal (±1-2%)
//   nominal menengah-gede      -> margin riil vs modal ±4-10%
// PENTING: nominal KECIL justru margin-nya PALING TIPIS di data referensi
// (kebalikan dari asumsi lama "kecil untungnya digedein persennya") --
// makanya tier di bawah sengaja dibikin persen KECIL utk modal kecil,
// biar gak malah jadi lebih mahal dari toko referensi di situ.
//
// Target sengaja diarahkan buat SEPADAN / dikit di bawah toko referensi
// (bukan agresif jauh di bawah), soalnya kalau kejauhan di bawah, margin
// abis duluan sebelum sempat untung. Simulasi vs 10 titik data referensi:
// hasilnya rata-rata ±0-4% di bawah (kadang malah dikit di atas ~1%), gak
// ada yang sampai jomplang jauh ke bawah kayak versi sebelumnya (2-6%).
//
// TAPI itu belum cukup -- skema % doang tetep bakal ngebubungin markup di
// modal yang BENERAN gede (topup jutaan rupiah), krn 4.5% dari modal
// Rp5.000.000 itu masih Rp225.000 sendiri, padahal gap harga riil di pasar
// buat nominal segede itu gak segitu. Makanya ditambahin MARKUP_CAP_ABSOLUT
// -- jadi markup jual = MANA YANG LEBIH KECIL antara (persen tier x modal)
// vs (modal + batas rupiah tetap). Ini niru pola nyata reseller besar:
// margin absolut mereka gak nambah linear sama gedenya modal.
//
// CATATAN: kalau nanti ternyata masih kemahalan/kemurahan dibanding toko
// referensi terbaru, tinggal update angka % di bawah -- gak perlu ubah
// logic lainnya. Abis update, klik "Markup Otomatis" lagi di dashboard
// (pilih semua produk) buat re-apply ke SEMUA produk yang udah ke-sync,
// gak cuma produk baru.
// ===========================================================
const MARKUP_TIERS = [
    { max: 30000, percent: 2 },
    { max: 1000000, percent: 5 },
    { max: Infinity, percent: 4.5 }
];
// Batas atas ABSOLUT (rupiah) buat markup, KHUSUS dipakai kalau hasil
// persen-nya lebih gede dari ini -- supaya modal yang beneran gede (topup
// jutaan) gak ditambahin untung yang ngebubung ikut-ikutan gede. null =
// gak ada batas (skema % doang, perilaku lama).
const MARKUP_CAP_ABSOLUT = 100000;
const AUTO_MARKUP_ROUND = 0; // 0 = harga jual gak dibulatkan ke kelipatan apa pun, cuma dibulatkan ke rupiah terdekat

function hitungMarkupWajar(hargaBeli) {
    const modal = Number(hargaBeli) || 0;
    const tier = MARKUP_TIERS.find((t) => modal <= t.max) || MARKUP_TIERS[MARKUP_TIERS.length - 1];
    const jualPersen = modal * (1 + tier.percent / 100);
    const jual = MARKUP_CAP_ABSOLUT !== null ? Math.min(jualPersen, modal + MARKUP_CAP_ABSOLUT) : jualPersen;
    return bulatkanKeAtas(jual, AUTO_MARKUP_ROUND);
}

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
function isForeignProduct(kategori, kodeProduk) {
    return isForeignRegion(kategori) || isForeignRegionCode(kodeProduk);
}

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

exports.smartActivateProducts = async (req, res) => {
    if (!["admin", "staff"].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    const { ids, maxAktifPerKategori } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "ids wajib diisi (array)" });
    }
    const cap = Number(maxAktifPerKategori) > 0 ? Number(maxAktifPerKategori) : DEFAULT_MAX_AKTIF_PER_KATEGORI;

    try {
        const { data: productsRaw, error: fetchErr } = await supabase
            .from("topup_products")
            .select("id, kode_produk, nama, kategori, harga_beli, is_active")
            .in("id", ids);
        if (fetchErr) return res.status(500).json({ message: "Gagal mengambil data produk" });

        // Aktivasi cerdas cuma buat produk region Indonesia -- kalaupun ada
        // produk region luar yang kebetulan udah kesimpen dari sync lama
        // (sebelum filter region ini ada), di sini dia dilewatin sama sekali.
        const products = (productsRaw || []).filter((p) => !isForeignProduct(p.kategori, p.kode_produk));
        const skippedForeignRegion = (productsRaw || []).length - products.length;

        const parsed = products.map((p) => ({ ...p, ...classifyProduct(p.nama) }));
        const skipped = parsed.filter((p) => p.groupType === null);
        const groupable = parsed.filter((p) => p.groupType !== null);

        // histori order sukses buat produk-produk ini, dipakai buat nentuin
        // kelompok mana yang "beneran laku" per kategori
        const kodeList = groupable.map((p) => p.kode_produk);
        const { data: orderRows } = kodeList.length
            ? await supabase.from("topup_orders").select("kode_produk").eq("status", "sukses").in("kode_produk", kodeList)
            : { data: [] };
        const salesCount = {};
        (orderRows || []).forEach((o) => {
            salesCount[o.kode_produk] = (salesCount[o.kode_produk] || 0) + 1;
        });

        const byKategori = {};
        groupable.forEach((p) => {
            const k = p.kategori || "(tanpa kategori)";
            if (!byKategori[k]) byKategori[k] = [];
            byKategori[k].push(p);
        });

        const activateIds = [];
        const deactivateIds = [];
        let filterPopularitasDipakai = false;

        for (const kategori of Object.keys(byKategori)) {
            const items = byKategori[kategori];

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
                const winner = [...g.items].sort((a, b) => Number(a.harga_beli) - Number(b.harga_beli))[0];
                const totalSales = g.items.reduce((sum, p) => sum + (salesCount[p.kode_produk] || 0), 0);
                return { ...g, winner, totalSales };
            });

            const kategoriPunyaHistori = scored.some((g) => g.totalSales > 0);
            if (kategoriPunyaHistori) {
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
            items.forEach((p) => {
                if (winnerIds.has(p.id)) activateIds.push(p.id);
                else deactivateIds.push(p.id);
            });
        }

        const beforeRows = [];
        const afterRows = [];
        const idsToUpdate = [];
        [...activateIds.map((id) => [id, true]), ...deactivateIds.map((id) => [id, false])].forEach(([id, target]) => {
            const prev = parsed.find((p) => p.id === id);
            if (prev && !!prev.is_active !== target) {
                beforeRows.push({ id, is_active: !!prev.is_active });
                afterRows.push({ id, is_active: target });
                idsToUpdate.push({ id, is_active: target });
            }
        });

        if (idsToUpdate.length > 0) {
            const results = await Promise.all(
                idsToUpdate.map((r) =>
                    supabase.from("topup_products").update({ is_active: r.is_active, updated_at: new Date().toISOString() }).eq("id", r.id)
                )
            );
            const failed = results.find((r) => r.error);
            if (failed) return res.status(500).json({ message: "Gagal update status produk" });

            await logAction({
                action: "smart_activate",
                label: `Aktivasi cerdas: ${idsToUpdate.filter((r) => r.is_active).length} aktif, ${idsToUpdate.filter((r) => !r.is_active).length} nonaktif`,
                ids: idsToUpdate.map((r) => r.id),
                beforeRows,
                afterRows,
                adminEmail: req.user.email
            });
        }

        notify(
            "product",
            `🧠 ${req.user.email} menjalankan aktivasi cerdas: ${activateIds.length} aktif, ${deactivateIds.length} nonaktif dari ${groupable.length} produk (${skipped.length} dilewatin krn nama produk gak kebaca nominalnya)`
        );
        res.json({
            message: `Aktivasi cerdas selesai: ${activateIds.length} produk diaktifkan, ${deactivateIds.length} dinonaktifkan${
                skipped.length ? `, ${skipped.length} dilewatin (nominal diamond gak kebaca dari namanya)` : ""
            }${skippedForeignRegion ? `, ${skippedForeignRegion} dilewatin (region luar Indonesia)` : ""}${
                filterPopularitasDipakai ? "" : " — belum ada histori order sukses, jadi filter popularitas belum diterapkan"
            }`,
            activated: activateIds.length,
            deactivated: deactivateIds.length,
            skipped: skipped.length,
            skippedForeignRegion,
            popularityFilterApplied: filterPopularitasDipakai
        });
    } catch (err) {
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
        .select(`id, ${column}`)
        .in("id", ids);
    if (fetchErr) throw new Error("Gagal mengambil data produk");

    const { error: updateErr } = await supabase
        .from("topup_products")
        .update({ [column]: newValue, updated_at: new Date().toISOString() })
        .in("id", ids);
    if (updateErr) throw new Error("Gagal update produk");

    await logAction({
        action,
        label,
        ids,
        beforeRows: (before || []).map((p) => ({ id: p.id, [column]: p[column] })),
        afterRows: (before || []).map((p) => ({ id: p.id, [column]: newValue })),
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

exports.getProducts = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("topup_products")
            .select("*")
            .eq("is_active", true)
            .order("kategori", { ascending: true })
            .order("sort_order", { ascending: true })
            .order("harga_jual", { ascending: true });

        if (error) {
            console.log(error);
            return res.status(500).json({ message: "Database Error" });
        }

        // Jaga-jaga (defense in depth): walaupun sync sekarang udah nolak produk
        // region luar Indonesia dari awal, baris LAMA yang kesimpen sebelum filter
        // ini ada masih mungkin nyangkut di DB. Disaring lagi di sini biar toko
        // publik gak PERNAH nampilin produk region luar Indonesia.
        const indoOnly = (data || []).filter((p) => !isForeignProduct(p.kategori, p.kode_produk));
        res.json(indoOnly);
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

// ADMIN — list semua produk topup (termasuk nonaktif), buat tabel dashboard
exports.getAllProductsAdmin = async (req, res) => {
    if (!["admin", "staff"].includes(req.user.role)) {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    try {
        const { data, error } = await supabase
            .from("topup_products")
            .select("*")
            .order("kategori", { ascending: true })
            .order("harga_jual", { ascending: true });

        if (error) return res.status(500).json({ message: "Database Error" });

        // Sama kayak getProducts: buang produk region luar Indonesia yang
        // mungkin masih nyangkut di DB dari sync lama (sebelum filter region
        // ada). Dashboard admin jadi cuma pernah nampilin produk region Indo,
        // gak perlu dropdown "pilih region" krn cuma ada 1 region yang diizinin.
        const indoOnly = (data || []).filter((p) => !isForeignProduct(p.kategori, p.kode_produk));
        res.json(indoOnly);
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
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
            .select("id, harga_beli, harga_jual, kategori")
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
            .select("*")
            .eq("kode_produk", kode_produk)
            .eq("is_active", true)
            .maybeSingle();

        if (prodErr || !product) {
            return res.status(404).json({ message: "Produk topup tidak ditemukan atau tidak aktif" });
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
                    console.log("Direct payment failed (IP whitelist/channel error), falling back to redirect:", directErr.ipaymuResponse || directErr.message);
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

        notify("topup", `💎 Pesanan topup baru ${orderId}: ${product.nama} ke ${tujuan} senilai ${rupiahLog(total)}${appliedPromoCode ? ` (promo ${appliedPromoCode})` : ""}`);

        if (isDirect) {
            // Sama seperti di orderController: nominal yang ditampilkan harus
            // yang beneran ke-encode di QR/VA iPaymu (bisa termasuk fee kalau
            // dibebankan ke pembeli), bukan total polos.
            const displayAmount = payment.amount || (total + (payment.fee || 0));
            
            sendUserWhatsApp(normalizedPhone, "pending", { name: "Pelanggan", order_id: orderId, total: rupiahLog(displayAmount) });

            res.status(201).json({
                message: "Pesanan topup berhasil dibuat",
                orderId,
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
                flow: "redirect",
                paymentUrl: payment.paymentUrl,
                debugDirectError: debugDirectError
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
            .select("kode_produk, harga_jual")
            .eq("kode_produk", kode_produk)
            .eq("is_active", true)
            .maybeSingle();

        if (prodErr || !product) {
            return res.status(404).json({ valid: false, message: "Produk topup tidak ditemukan" });
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
            .select("id, status, harga, subtotal, discount_amount, promo_code, nama_produk, tujuan, server_id, payment_method, tv_sn, created_at, updated_at")
            .eq("id", req.params.id)
            .maybeSingle();

        if (error || !order) return res.status(404).json({ message: "Transaksi tidak ditemukan" });

        res.json({
            id: order.id,
            type: "topup",
            status: order.status,
            nama_produk: order.nama_produk,
            tujuan: order.tujuan,
            server_id: order.server_id,
            payment_method: order.payment_method,
            // SN cuma ditampilin kalau statusnya udah sukses
            serial_number: order.status === "sukses" ? order.tv_sn : null,
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
        res.json(data);
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
        else finalStatus = statusMap[result.status] || "processing";

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
    const statusMap = { sukses: "sukses", gagal: "gagal", pending: "processing" };
    let finalStatus = "processing";
    if (result.status === 0 || result.status === "0") finalStatus = "gagal";
    else finalStatus = statusMap[result.status] || "processing";
    
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

    if (finalStatus !== "sukses") {
        query = query.neq("status", "sukses");
    }
    if (finalStatus === "sukses") {
        query = query.neq("status", "sukses");
    }

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
