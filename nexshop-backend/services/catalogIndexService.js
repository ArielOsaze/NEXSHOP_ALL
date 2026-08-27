const supabase = require("../config/db");
const {
    hitungMarkupWajar,
    cleanProductName,
    isCheckerUtilityProduct,
    isForeignProduct,
    isGameProduct,
    isPascabayarProduct
} = require("../utils/topupHelpers");
const { getProductContract, isGameVoucher } = require("../utils/productContract");

// ===========================================================
// INDEKS KATALOG PUBLIK (untuk lazy loading & pencarian sisi server)
//
// Masalah yang diselesaikan:
// Halaman utama dan Marketplace sama-sama menarik SELURUH katalog sekaligus
// (/topup/products dan /topup/public-catalog), lalu mengelompokkannya di
// browser hanya untuk menampilkan kartu per game/operator. Padahal isi kartu
// cuma butuh nama, logo, jumlah produk, dan harga termurah. Akibatnya:
//   * payload awal membengkak seiring katalog bertambah (ribuan baris,
//     lengkap dengan seluruh kolomnya) -- berat di kuota dan di HP kentang,
//   * seluruh daftar harus selesai diunduh & di-parse sebelum satu kartu pun
//     muncul,
//   * memori tab ikut menahan ribuan objek yang 99% isinya tidak dipakai
//     sampai user benar-benar membuka satu game.
//
// Solusinya BUKAN sekadar memotong daftar di browser -- itu justru merusak
// pencarian (yang belum terunduh tidak akan pernah ketemu). Yang dilakukan
// di sini: server membangun INDEKS RINGKAS satu kali, menyimpannya di memori
// dengan TTL pendek, lalu melayani:
//   * halaman kartu terpaginasi (lazy load / "muat lebih banyak"),
//   * pencarian yang menelusuri SELURUH katalog -- termasuk nama produk di
//     dalam grup yang kartunya belum pernah dikirim ke browser,
//   * daftar produk satu grup, diambil hanya ketika grupnya dibuka.
//
// Cache-nya dipakai bersama semua pengunjung karena isinya identik untuk
// semua orang: harga reseller TIDAK disimpan di sini, melainkan diterapkan
// per-request setelah data diambil dari cache (lihat terapkanHargaReseller
// di controller).
// ===========================================================

const TTL_MS = 3 * 60 * 1000; // katalog berubah hanya saat sync admin
const PAGE_SIZE_DB = 1000;

let cache = null;
let cacheAt = 0;
let inflight = null;

function isFresh() {
    return cache && Date.now() - cacheAt < TTL_MS;
}

/**
 * Dipanggil setelah sync katalog / perubahan produk oleh admin supaya
 * etalase publik tidak menunggu TTL habis untuk menampilkan data baru.
 */
function invalidateCatalogIndex() {
    cache = null;
    cacheAt = 0;
}

async function ambilSemuaProdukAktif() {
    const kolom = [
        "id", "nama", "kode_produk", "kategori", "sort_order",
        "source_category_name", "source_operator_id", "source_operator_name", "source_jenis_name",
        "source_format_form", "source_requires_server_id", "harga_beli", "harga_jual", "butuh_server_id", "source_status",
        "operator_logo", "item_icon", "manual_category_override", "manual_name_override"
    ].join(", ");

    const semua = [];
    let halaman = 0;

    while (true) {
        const { data, error } = await supabase
            .from("topup_products")
            .select(kolom)
            .eq("is_active", true)
            .order("kategori", { ascending: true })
            .order("sort_order", { ascending: true })
            .order("harga_jual", { ascending: true })
            .range(halaman * PAGE_SIZE_DB, (halaman + 1) * PAGE_SIZE_DB - 1);

        if (error) throw error;
        if (!data || data.length === 0) break;

        semua.push(...data);
        if (data.length < PAGE_SIZE_DB) break;
        halaman++;
    }

    return semua;
}

async function ambilPetaKategori() {
    const peta = new Map();
    try {
        const { data, error } = await supabase
            .from("topup_category_map")
            .select("tokovoucher_category_name, nexshop_category_name");
        if (!error && data) {
            data.forEach((m) => peta.set(m.tokovoucher_category_name, m.nexshop_category_name));
        }
    } catch (_) {
        /* peta kategori opsional -- tanpa itu jatuh ke "Lainnya" */
    }
    return peta;
}

// Teks yang dipakai mesin pencari sisi server. Digabung jadi satu string
// huruf kecil supaya pencocokan token tidak perlu menyusuri banyak field.
function bangunTeksCari(grup) {
    const bagian = [grup.name, grup.category];
    grup.products.forEach((p) => bagian.push(p.nama, p.kode_produk));
    return bagian.filter(Boolean).join(" ").toLowerCase();
}

function ringkasGrup(grup) {
    const harga = grup.products
        .map((p) => Number(p.harga_jual) || 0)
        .filter((n) => n > 0);

    return {
        id: grup.id,
        name: grup.name,
        category: grup.category,
        logo: grup.logo || null,
        product_count: grup.products.length,
        min_price: harga.length ? Math.min(...harga) : null,
        butuh_server_id: grup.products.some((p) => p.butuh_server_id),
        cek_tagihan: grup.products.some((p) => p.cek_tagihan)
    };
}

// Bersihkan produk dari field internal SEBELUM disimpan di cache, supaya
// tidak mungkin bocor lewat jalur mana pun. harga_beli (harga modal) adalah
// margin internal dan tidak boleh pernah sampai ke client.
function bersihkanProduk(p, manualName, displayCategory) {
    const contract = getProductContract({ ...p, kategori: displayCategory || p.kategori });
    return {
        id: p.id,
        nama: manualName ? p.nama : cleanProductName(p.nama),
        kode_produk: p.kode_produk,
        kategori: p.kategori,
        harga_jual: p.harga_jual,
        butuh_server_id: contract.server_id.required,
        target_kind: contract.target.kind,
        checkout_contract: {
            version: contract.version,
            review_required: contract.review_required,
            target: contract.target,
            server_id: contract.server_id
        },
        item_icon: p.item_icon || null,
        cek_tagihan: isPascabayarProduct(p)
    };
}

async function bangunIndeks() {
    const [produk, petaKategori] = await Promise.all([ambilSemuaProdukAktif(), ambilPetaKategori()]);

    const gameMap = new Map();     // etalase "Topup Diamond" di halaman utama
    const operatorMap = new Map(); // etalase Marketplace (PPOB)

    for (const p of produk) {
        // Produk yang provider-nya menandai non-aktif tidak pernah tampil.
        if (p.source_status && p.source_status !== "active") continue;
        // SKU utilitas "Cek Nama/ID/Nickname" bukan produk jualan.
        if (isCheckerUtilityProduct(p.nama)) continue;
        // Pertahanan berlapis: baris lama region luar Indonesia.
        if (isForeignProduct(p.kategori, p.kode_produk)) continue;

        // Harga jual 0 -> hitung dari harga modal memakai aturan markup resmi.
        if (!p.harga_jual || Number(p.harga_jual) === 0) {
            p.harga_jual = hitungMarkupWajar(p.harga_beli || 0, p.kategori, p.source_operator_name);
        }

        // Kategori tampilan: override manual -> peta kategori -> "Lainnya".
        let displayCategory = "Lainnya";
        if (p.manual_category_override) {
            displayCategory = p.kategori || "Lainnya";
        } else if (p.source_category_name && petaKategori.has(p.source_category_name)) {
            displayCategory = petaKategori.get(p.source_category_name);
        } else if (petaKategori.has(p.kategori)) {
            displayCategory = petaKategori.get(p.kategori);
        }

        const produkBersih = bersihkanProduk(p, p.manual_name_override, displayCategory);
        const isVoucherGame = isGameVoucher({ ...p, kategori: displayCategory });
        const isGame = isGameProduct({ ...p, kategori: displayCategory }, displayCategory) && !isVoucherGame;

        if (isGame) {
            // Grup game memakai nama operator (Mobile Legends, PUBG, ...);
            // kolom kategori untuk hasil sync semuanya berisi "Gaming",
            // jadi mengelompokkan per kategori akan menempelkan semua game
            // jadi satu kartu.
            const nama = (p.source_operator_name && String(p.source_operator_name).trim())
                || (p.kategori && String(p.kategori).trim())
                || "Lainnya";
            const kunci = nama.toLowerCase();

            if (!gameMap.has(kunci)) {
                gameMap.set(kunci, {
                    id: kunci,
                    name: nama,
                    category: displayCategory,
                    logo: p.operator_logo || null,
                    products: []
                });
            }
            const g = gameMap.get(kunci);
            if (!g.logo && p.operator_logo) g.logo = p.operator_logo;
            g.products.push(produkBersih);
        } else {
            const nama = p.source_operator_name || p.kategori || "Unknown";
            const kunci = String(p.source_operator_id || nama).toLowerCase();

            if (!operatorMap.has(kunci)) {
                operatorMap.set(kunci, {
                    id: kunci,
                    name: nama,
                    category: displayCategory,
                    logo: p.operator_logo || null,
                    products: []
                });
            }
            const o = operatorMap.get(kunci);
            if (!o.logo && p.operator_logo) o.logo = p.operator_logo;
            o.products.push(produkBersih);
        }
    }

    const siapkan = (map) => {
        const daftar = [...map.values()];
        daftar.forEach((g) => {
            g.search_text = bangunTeksCari(g);
            g.summary = ringkasGrup(g);
        });
        return daftar;
    };

    const games = siapkan(gameMap);
    const operators = siapkan(operatorMap);

    return {
        games,
        operators,
        gamesById: new Map(games.map((g) => [g.id, g])),
        operatorsById: new Map(operators.map((o) => [o.id, o])),
        // Faset kategori LENGKAP dengan jumlah operatornya. Dihitung dari
        // seluruh indeks, bukan dari halaman yang kebetulan sedang dikirim --
        // kalau dihitung dari potongan halaman, angka di chip filter akan
        // ikut berubah-ubah tiap kali user menekan "muat lebih banyak".
        categories: (() => {
            const hitung = new Map();
            operators.forEach((o) => {
                if (!o.category) return;
                hitung.set(o.category, (hitung.get(o.category) || 0) + 1);
            });
            const kategori = [...hitung.entries()]
                .map(([name, count]) => ({ name, count }));
            return urutkanKategoriMarketplace(kategori);
        })(),
        total_operators: operators.length,
        total_games: games.length,
        builtAt: Date.now()
    };
}

/**
 * Ambil indeks dari cache; bangun kalau kedaluwarsa.
 * Permintaan bersamaan berbagi satu proses build (inflight) supaya tidak ada
 * cache stampede -- tanpa itu, sepuluh pengunjung yang datang bersamaan saat
 * cache habis akan memicu sepuluh kali pemindaian tabel sekaligus.
 */
async function getCatalogIndex() {
    if (isFresh()) return cache;
    if (inflight) return inflight;

    inflight = (async () => {
        try {
            const hasil = await bangunIndeks();
            cache = hasil;
            cacheAt = Date.now();
            return hasil;
        } finally {
            inflight = null;
        }
    })();

    return inflight;
}

// Pencocokan token: semua kata kunci harus ada (AND), sehingga
// "ml 86" menemukan "Mobile Legends 86 Diamond" tapi tidak menyeret
// seluruh produk yang cuma mengandung "86".
function cocokSemuaToken(teks, tokens) {
    return tokens.every((t) => teks.includes(t));
}

function urutkanPopuler(daftar, urutanPopuler) {
    const rank = (nama) => {
        const n = String(nama || "").toLowerCase();
        const i = urutanPopuler.findIndex((kw) => n.includes(kw));
        return i === -1 ? urutanPopuler.length : i;
    };
    return daftar.sort((a, b) => {
        const ra = rank(a.name);
        const rb = rank(b.name);
        if (ra !== rb) return ra - rb;
        return a.name.localeCompare(b.name, "id");
    });
}

// Saat mencari, ranking populer sengaja tidak dipakai. Hasil yang nama
// grupnya paling dekat dengan query harus tampil lebih dulu; kecocokan yang
// hanya berasal dari nama/kode produk tetap ditemukan, tetapi diletakkan
// setelah kecocokan nama game.
function urutkanPencarian(daftar, query) {
    const q = String(query || "").toLowerCase().trim();
    const tokens = q.split(/\s+/).filter(Boolean);
    if (!tokens.length) return daftar;

    const skor = (grup) => {
        const nama = String(grup.name || "").toLowerCase().trim();
        const teks = String(grup.search_text || "").toLowerCase();

        if (nama === q) return 0;
        if (nama.startsWith(q)) return 1;
        if (nama.includes(q)) return 2;
        if (cocokSemuaToken(nama, tokens)) return 3;
        if (teks.includes(q)) return 4;
        return 5;
    };

    return daftar.sort((a, b) => {
        const selisih = skor(a) - skor(b);
        return selisih || a.name.localeCompare(b.name, "id");
    });
}

/**
 * Satu halaman kartu, plus total hasil supaya frontend tahu kapan
 * tombol "muat lebih banyak" harus berhenti.
 *
 * PENTING: filter pencarian dijalankan atas SELURUH indeks, bukan atas
 * halaman yang sudah terkirim. Inilah yang membuat pencarian tetap benar
 * walau browser baru memuat sebagian kartu.
 */
function compareMarketplaceCategory(a, b) {
    const aName = typeof a === "string" ? a : a?.category || a?.name;
    const bName = typeof b === "string" ? b : b?.category || b?.name;
    const aLainnya = String(aName || "").trim().toLowerCase() === "lainnya";
    const bLainnya = String(bName || "").trim().toLowerCase() === "lainnya";
    if (aLainnya !== bLainnya) return aLainnya ? 1 : -1;
    return String(aName || "Lainnya").localeCompare(String(bName || "Lainnya"), "id");
}

function urutkanKategoriMarketplace(daftar) {
    return [...(daftar || [])].sort(compareMarketplaceCategory);
}

function urutkanMarketplaceOperators(daftar) {
    return [...(daftar || [])].sort((a, b) => {
        const categoryCompare = compareMarketplaceCategory(a, b);
        if (categoryCompare !== 0) return categoryCompare;
        return String(a?.name || "").localeCompare(String(b?.name || ""), "id");
    });
}

function halamanGrup(daftar, { page = 1, limit = 24, q = "", kategori = "" } = {}) {
    const tokens = String(q || "").toLowerCase().trim().split(/\s+/).filter(Boolean);
    const kat = String(kategori || "").trim();

    let hasil = daftar;

    if (kat && kat.toLowerCase() !== "all") {
        hasil = hasil.filter((g) => g.category === kat);
    }
    if (tokens.length) {
        hasil = hasil.filter((g) => cocokSemuaToken(g.search_text, tokens));
    }

    const total = hasil.length;
    const perPage = Math.min(60, Math.max(1, Number(limit) || 24));
    const halaman = Math.max(1, Number(page) || 1);
    const mulai = (halaman - 1) * perPage;
    const potongan = hasil.slice(mulai, mulai + perPage);

    return {
        page: halaman,
        limit: perPage,
        total,
        total_pages: Math.ceil(total / perPage),
        has_more: mulai + potongan.length < total,
        items: potongan.map((g) => g.summary)
    };
}

module.exports = {
    getCatalogIndex,
    invalidateCatalogIndex,
    halamanGrup,
    urutkanKategoriMarketplace,
    urutkanMarketplaceOperators,
    urutkanPopuler,
    urutkanPencarian,
    TTL_MS
};
