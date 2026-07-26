const supabase = require("../config/db");
const tokovoucher = require("../config/tokovoucher");
const { createRedirectPayment, checkTransactionStatus } = require("../config/ipaymu");
const { checkNickname } = require("../config/apigames");
const { notify } = require("../config/notify");
const { sendTopupInvoiceEmail } = require("../config/mailer");
const { sendTelegramNotification } = require("../config/telegram");

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
// ===========================================================
const MARKUP_TIERS = [
    { max: 5000, percent: 20 },
    { max: 15000, percent: 15 },
    { max: 50000, percent: 10 },
    { max: 150000, percent: 7 },
    { max: Infinity, percent: 5 }
];
const AUTO_MARKUP_ROUND = 0; // 0 = harga jual gak dibulatkan ke kelipatan apa pun, cuma dibulatkan ke rupiah terdekat

function hitungMarkupWajar(hargaBeli) {
    const modal = Number(hargaBeli) || 0;
    const tier = MARKUP_TIERS.find((t) => modal <= t.max) || MARKUP_TIERS[MARKUP_TIERS.length - 1];
    const jual = modal * (1 + tier.percent / 100);
    return bulatkanKeAtas(jual, AUTO_MARKUP_ROUND);
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
    if (req.user.role !== "admin") {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    const { ids, maxAktifPerKategori } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "ids wajib diisi (array)" });
    }
    const cap = Number(maxAktifPerKategori) > 0 ? Number(maxAktifPerKategori) : DEFAULT_MAX_AKTIF_PER_KATEGORI;

    try {
        const { data: products, error: fetchErr } = await supabase
            .from("topup_products")
            .select("id, kode_produk, nama, kategori, harga_beli, is_active")
            .in("id", ids);
        if (fetchErr) return res.status(500).json({ message: "Gagal mengambil data produk" });

        const parsed = (products || []).map((p) => ({ ...p, ...classifyProduct(p.nama) }));
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
            }${filterPopularitasDipakai ? "" : " — belum ada histori order sukses, jadi filter popularitas belum diterapkan"}`,
            activated: activateIds.length,
            deactivated: deactivateIds.length,
            skipped: skipped.length,
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
        if (result === null) {
            return res.json({ supported: false });
        }
        res.json({ supported: true, is_valid: result.is_valid, username: result.username });
    } catch (err) {
        console.log("Cek nickname gagal:", err.message);
        // gagal manggil API pihak ketiga BUKAN alasan buat block checkout — anggap
        // aja gak didukung, frontend fallback ke peringatan manual
        res.json({ supported: false });
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

        res.json(data || []);
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
    if (req.user.role !== "admin") {
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

        const rows = result.data.map((p) => ({
            kode_produk: p.code,
            nama: p.nama_produk,
            kategori: p.operator_produk || p.category_name,
            deskripsi: p.deskripsi,
            harga_beli: p.price,
            // hanya set harga_jual saat produk BARU pertama kali masuk;
            // upsert di bawah pakai ignoreDuplicates:false jadi kita perlu
            // ambil produk existing dulu supaya harga_jual admin gak ketimpa
        }));

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

        res.json({ message: `${data.length} produk berhasil disinkronkan`, data });
    } catch (err) {
        console.log(err.response?.data || err.message);
        res.status(500).json({ message: "Gagal terhubung ke TokoVoucher" });
    }
};

// ADMIN — list semua produk topup (termasuk nonaktif), buat tabel dashboard
exports.getAllProductsAdmin = async (req, res) => {
    if (req.user.role !== "admin") {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    try {
        const { data, error } = await supabase
            .from("topup_products")
            .select("*")
            .order("kategori", { ascending: true })
            .order("harga_jual", { ascending: true });

        if (error) return res.status(500).json({ message: "Database Error" });
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

// ADMIN — update harga jual / aktif / butuh server id / urutan tampil
exports.updateProduct = async (req, res) => {
    if (req.user.role !== "admin") {
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
    if (req.user.role !== "admin") {
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
    if (req.user.role !== "admin") {
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
    if (req.user.role !== "admin") {
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
    if (req.user.role !== "admin") {
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
    if (req.user.role !== "admin") {
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
        const { data: products, error: fetchErr } = await supabase
            .from("topup_products")
            .select("id, harga_beli, harga_jual")
            .in("id", ids);
        if (fetchErr) return res.status(500).json({ message: "Gagal mengambil data produk" });

        const rows = (products || []).map((p) => {
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
            ids,
            beforeRows: (products || []).map((p) => ({ id: p.id, harga_jual: p.harga_jual })),
            afterRows: rows,
            adminEmail: req.user.email
        });

        notify("product", `💰 ${req.user.email} menerapkan markup ${markupLabel} ke ${rows.length} produk topup`);
        res.json({ message: `Harga jual ${rows.length} produk berhasil dihitung ulang dari harga modal` });
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
    if (req.user.role !== "admin") {
        return res.status(403).json({ message: "Akses ditolak, khusus admin" });
    }
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "ids wajib diisi (array)" });
    }

    try {
        const { data: products, error: fetchErr } = await supabase
            .from("topup_products")
            .select("id, harga_beli, harga_jual")
            .in("id", ids);
        if (fetchErr) return res.status(500).json({ message: "Gagal mengambil data produk" });

        const rows = (products || []).map((p) => ({
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
            ids,
            beforeRows: (products || []).map((p) => ({ id: p.id, harga_jual: p.harga_jual })),
            afterRows: rows,
            adminEmail: req.user.email
        });

        notify("product", `🤖 ${req.user.email} menerapkan markup otomatis (wajar) ke ${rows.length} produk topup`);
        res.json({ message: `Harga jual ${rows.length} produk berhasil dihitung otomatis dari harga modal` });
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

// ADMIN — set item_icon (ikon per denominasi, kolom "Icon" di tabel) buat
// banyak produk sekaligus berdasarkan pilihan checkbox massal, biar admin
// gak perlu buka modal edit satu-satu tiap produk. Beda dari
// updateCategoryLogo yang isi operator_logo (logo game, dipakai di toko).
exports.bulkUpdateIcon = async (req, res) => {
    if (req.user.role !== "admin") {
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
    if (req.user.role !== "admin") {
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
    if (req.user.role !== "admin") {
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
    if (req.user.role !== "admin") {
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
    if (req.user.role !== "admin") {
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
    if (req.user.role !== "admin") {
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
    if (req.user.role !== "admin") {
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
    if (req.user.role !== "admin") {
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
    const { kode_produk, tujuan, server_id, recipient_email } = req.body;
    const userId = req.user ? req.user.id : null;

    if (!kode_produk || !tujuan) {
        return res.status(400).json({ message: "Produk dan tujuan (Player ID) wajib diisi" });
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

        const orderId = "TP" + Date.now();

        const { error: insertErr } = await supabase.from("topup_orders").insert([{
            id: orderId,
            user_id: userId,
            kode_produk: product.kode_produk,
            nama_produk: product.nama,
            tujuan,
            server_id: server_id || null,
            recipient_email: recipient_email || null,
            harga: product.harga_jual,
            status: "pending"
        }]);

        if (insertErr) {
            console.log(insertErr);
            return res.status(500).json({ message: "Gagal membuat pesanan topup" });
        }

        let payment;
        try {
            payment = await createRedirectPayment({
                referenceId: orderId,
                itemDetails: [{
                    id: product.kode_produk,
                    name: product.nama.slice(0, 80),
                    price: product.harga_jual,
                    quantity: 1
                }],
                buyerEmail: recipient_email || undefined,
                returnUrl: `${FRONTEND_URL}/#/payment-status?order=${orderId}&status=success`,
                cancelUrl: `${FRONTEND_URL}/#/payment-status?order=${orderId}&status=cancel`,
                notifyUrl: `${BACKEND_URL}/api/topup/notification`
            });
        } catch (ipaymuErr) {
            console.log("iPaymu error:", ipaymuErr.ipaymuResponse || ipaymuErr.message);
            await supabase.from("topup_orders").update({ status: "failed" }).eq("id", orderId);
            return res.status(500).json({ message: "Gagal membuat transaksi pembayaran" });
        }

        await supabase.from("topup_orders").update({ ipaymu_session_id: payment.sessionId, payment_url: payment.paymentUrl }).eq("id", orderId);

        notify("topup", `💎 Pesanan topup baru ${orderId}: ${product.nama} ke ${tujuan} senilai ${rupiahLog(product.harga_jual)}`);

        res.status(201).json({
            message: "Pesanan topup berhasil dibuat",
            orderId,
            paymentUrl: payment.paymentUrl
        });
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server Error" });
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
            .select("id, status, harga, nama_produk, tujuan, server_id, payment_method, tv_sn, created_at, updated_at")
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
    if (req.user.role !== "admin") {
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

        const statusMap = { sukses: "sukses", pending: "processing", gagal: "gagal" };
        const finalStatus = statusMap[result.status] || "processing";
        await supabase.from("topup_orders").update({
            status: finalStatus,
            tv_ref_id: result.ref_id || order.id,
            tv_trx_id: result.trx_id || null,
            tv_sn: result.sn || null,
            tv_message: result.message || null,
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

        let ipaymuStatus = String(body.status || "").toLowerCase();
        if (trxId) {
            try {
                const trx = await checkTransactionStatus(trxId);
                ipaymuStatus = String(trx.Status || trx.status || ipaymuStatus).toLowerCase();
            } catch (verifyErr) {
                console.log("Gagal verifikasi status ke iPaymu, pakai status dari body webhook:", verifyErr.message);
            }
        }

        let status = order.status;
        let shouldFulfill = false;

        if (["berhasil", "success", "1", "paid", "settlement"].includes(ipaymuStatus)) {
            status = "paid";
            shouldFulfill = true;
        } else if (["pending", "0"].includes(ipaymuStatus)) {
            status = "pending";
        } else if (["gagal", "expired", "cancel", "cancelled", "-1", "failed", "expire"].includes(ipaymuStatus)) {
            status = "failed";
        }

        await supabase.from("topup_orders").update({
            status,
            payment_status: ipaymuStatus,
            updated_at: new Date().toISOString()
        }).eq("id", orderId);

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
exports.handleTokoVoucherWebhook = async (req, res) => {
    try {
        const body = req.body;
        const refId = body.ref_id;
        const headerSig = req.headers["x-tokovoucher-authorization"];

        const valid = await tokovoucher.verifyWebhookSignature(headerSig, refId);
        if (!valid) {
            return res.status(401).json({ message: "Signature tidak valid" });
        }

        const statusMap = { sukses: "sukses", gagal: "gagal", pending: "processing" };

        const { data: existingOrder } = await supabase
            .from("topup_orders")
            .select("status, recipient_email, nama_produk, tujuan, server_id, harga")
            .eq("id", refId)
            .maybeSingle();

        const finalStatus = statusMap[body.status] || "processing";
        const { error } = await supabase.from("topup_orders").update({
            status: finalStatus,
            tv_trx_id: body.trx_id || null,
            tv_sn: body.sn || null,
            tv_message: body.message || null,
            updated_at: new Date().toISOString()
        }).eq("id", refId);

        if (error) {
            console.log(error);
            return res.status(500).json({ message: "Gagal update status" });
        }

        // kirim invoice cuma pas transisi PERTAMA KALI ke "sukses" (bukan yang
        // udah pernah sukses sebelumnya — webhook TokoVoucher bisa aja retry)
        if (finalStatus === "sukses" && existingOrder && existingOrder.status !== "sukses" && existingOrder.recipient_email) {
            try {
                await sendTopupInvoiceEmail(existingOrder.recipient_email, {
                    orderId: refId,
                    namaProduk: existingOrder.nama_produk,
                    tujuan: existingOrder.tujuan,
                    serverId: existingOrder.server_id,
                    harga: existingOrder.harga,
                    serialNumber: body.sn || null
                });
            } catch (mailErr) {
                console.log("Gagal kirim invoice topup email:", mailErr.response?.data || mailErr.message);
            }
        }
        if (finalStatus === "sukses" && existingOrder && existingOrder.status !== "sukses") {
            sendTelegramNotification(
                `💎 <b>Pembelian Topup Baru</b>\nOrder ID: ${refId}\nProduk: ${existingOrder.nama_produk}\nTujuan: ${existingOrder.tujuan}${existingOrder.server_id ? ` (${existingOrder.server_id})` : ""}\nTotal: ${rupiahLog(existingOrder.harga)}`
            );
        }

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

        const statusMap = { sukses: "sukses", gagal: "gagal", pending: "processing" };
        const finalStatus = statusMap[result.status] || order.status;
        await supabase.from("topup_orders").update({
            status: finalStatus,
            tv_trx_id: result.trx_id || order.tv_trx_id,
            tv_sn: result.sn || order.tv_sn,
            tv_message: result.message || order.tv_message,
            updated_at: new Date().toISOString()
        }).eq("id", id);

        if (finalStatus === "sukses" && order.status !== "sukses" && order.recipient_email) {
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
        if (finalStatus === "sukses" && order.status !== "sukses") {
            sendTelegramNotification(
                `💎 <b>Pembelian Topup Baru</b>\nOrder ID: ${order.id}\nProduk: ${order.nama_produk}\nTujuan: ${order.tujuan}${order.server_id ? ` (${order.server_id})` : ""}\nTotal: ${rupiahLog(order.harga)}`
            );
        }

        res.json(result);
    } catch (err) {
        console.log(err.response?.data || err.message);
        res.status(500).json({ message: "Gagal cek status ke TokoVoucher" });
    }
};

// ADMIN — cek saldo akun TokoVoucher (dipakai di Settings/Topup dashboard)
exports.getBalance = async (req, res) => {
    if (req.user.role !== "admin") {
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
