/**
 * REGRESSION TEST SUITE 14: Pemuatan katalog bertahap & pencarian sisi server.
 *
 * Menjaga dua sifat yang gampang rusak saat katalog dipecah per halaman:
 *
 *  A. Paginasi konsisten -- tiap kartu muncul TEPAT sekali di seluruh
 *     halaman, tidak ada yang dobel maupun terlewat.
 *  B. Pencarian tetap menjangkau SELURUH katalog, termasuk nama produk di
 *     dalam grup yang kartunya belum pernah dikirim ke browser. Ini poin
 *     utamanya: kalau penyaringan pindah ke sisi klien, halaman jadi ringan
 *     tapi pencarian diam-diam jadi salah -- menukar satu bug dengan bug
 *     yang lebih sulit terlihat.
 *
 * Tidak butuh jaringan maupun database.
 * Jalankan: node regtest/sim14_catalog_lazy_search.js
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { halamanGrup, urutkanPopuler, urutkanPencarian } = require("../nexshop-backend/services/catalogIndexService");

console.log("===============================================================================");
console.log("  NEXSHOP REGTEST 14: KATALOG BERTAHAP & PENCARIAN SISI SERVER");
console.log("===============================================================================\n");

let passed = 0;
let total = 0;

function test(name, fn) {
    total++;
    try {
        fn();
        console.log("  [PASS] " + name);
        passed++;
    } catch (err) {
        console.error("  [FAIL] " + name);
        console.error("         " + err.message + "\n");
        process.exitCode = 1;
    }
}

// -------------------------------------------------------------
// Indeks tiruan, bentuknya sama dengan hasil bangunIndeks()
// -------------------------------------------------------------
function buatGrup(id, nama, kategori, produk) {
    const g = {
        id,
        name: nama,
        category: kategori,
        logo: null,
        products: produk.map((p, i) => ({
            id: id + "-" + i,
            nama: p.nama,
            kode_produk: p.kode,
            harga_jual: p.harga,
            butuh_server_id: false
        }))
    };
    g.search_text = [g.name, g.category, ...g.products.map((p) => p.nama + " " + p.kode_produk)]
        .join(" ")
        .toLowerCase();
    const harga = g.products.map((p) => p.harga_jual).filter((n) => n > 0);
    g.summary = {
        id: g.id,
        name: g.name,
        category: g.category,
        logo: null,
        product_count: g.products.length,
        min_price: harga.length ? Math.min(...harga) : null
    };
    return g;
}

const INDEKS = [
    buatGrup("mobile legends", "Mobile Legends", "Topup Game", [
        { nama: "86 Diamond", kode: "ML86", harga: 20000 },
        { nama: "172 Diamond", kode: "ML172", harga: 39000 },
        { nama: "Weekly Diamond Pass", kode: "MLWDP", harga: 27000 }
    ]),
    buatGrup("free fire", "Free Fire", "Topup Game", [
        { nama: "70 Diamond", kode: "FF70", harga: 9000 },
        { nama: "140 Diamond", kode: "FF140", harga: 18000 }
    ]),
    buatGrup("pubg mobile", "PUBG Mobile", "Topup Game", [
        { nama: "60 UC", kode: "PUBG60", harga: 15000 }
    ]),
    buatGrup("dana", "DANA", "E-Money", [
        { nama: "Saldo DANA 50.000", kode: "DANA50", harga: 51500 },
        { nama: "Saldo DANA 100.000", kode: "DANA100", harga: 101500 }
    ]),
    buatGrup("pln", "PLN Token", "PLN", [
        { nama: "Token Listrik 20.000", kode: "PLN20", harga: 21000 },
        { nama: "Token Listrik 50.000", kode: "PLN50", harga: 51000 }
    ]),
    buatGrup("telkomsel", "Telkomsel", "Pulsa", [
        { nama: "Pulsa 10.000", kode: "TSEL10", harga: 11500 }
    ]),
    buatGrup("genshin impact", "Genshin Impact", "Topup Game", [
        { nama: "60 Genesis Crystal", kode: "GI60", harga: 16000 }
    ])
];

// -------------------------------------------------------------
// A. PAGINASI
// -------------------------------------------------------------
console.log("A. Paginasi kartu\n");

test("halaman pertama mengembalikan tepat `limit` kartu", () => {
    const h = halamanGrup(INDEKS, { page: 1, limit: 3 });
    assert.strictEqual(h.items.length, 3);
    assert.strictEqual(h.total, INDEKS.length);
    assert.strictEqual(h.has_more, true);
});

test("halaman terakhir menandai has_more = false", () => {
    const h = halamanGrup(INDEKS, { page: 3, limit: 3 });
    assert.strictEqual(h.items.length, 1, "7 item dengan limit 3 -> halaman 3 berisi 1");
    assert.strictEqual(h.has_more, false);
});

test("menyusuri semua halaman memberi tiap kartu TEPAT sekali", () => {
    const terkumpul = [];
    let page = 1;
    let lagi = true;
    let penjaga = 0;

    while (lagi) {
        if (++penjaga > 50) throw new Error("paginasi tidak pernah berhenti");
        const h = halamanGrup(INDEKS, { page, limit: 2 });
        terkumpul.push(...h.items.map((i) => i.id));
        lagi = h.has_more;
        page++;
    }

    assert.strictEqual(terkumpul.length, INDEKS.length, "jumlah total tidak cocok");
    assert.strictEqual(new Set(terkumpul).size, INDEKS.length, "ada kartu yang muncul lebih dari sekali");
    for (const g of INDEKS) {
        assert.ok(terkumpul.includes(g.id), "kartu terlewat: " + g.id);
    }
});

test("halaman di luar jangkauan mengembalikan daftar kosong, bukan error", () => {
    const h = halamanGrup(INDEKS, { page: 99, limit: 10 });
    assert.strictEqual(h.items.length, 0);
    assert.strictEqual(h.has_more, false);
    assert.strictEqual(h.total, INDEKS.length);
});

test("limit dibatasi ke rentang aman", () => {
    assert.strictEqual(halamanGrup(INDEKS, { page: 1, limit: 9999 }).limit, 60, "limit berlebihan harus dipangkas");
    assert.strictEqual(halamanGrup(INDEKS, { page: 1, limit: 0 }).limit, 24, "limit 0 jatuh ke default");
    assert.strictEqual(halamanGrup(INDEKS, { page: -5, limit: 3 }).page, 1, "halaman negatif dinormalkan ke 1");
});

// -------------------------------------------------------------
// B. PENCARIAN SISI SERVER
// -------------------------------------------------------------
console.log("\nB. Pencarian menjangkau seluruh katalog\n");

test("mencari nama grup", () => {
    const h = halamanGrup(INDEKS, { page: 1, limit: 24, q: "free fire" });
    assert.strictEqual(h.total, 1);
    assert.strictEqual(h.items[0].name, "Free Fire");
});

test("mencari NAMA PRODUK di dalam grup (bukan nama grupnya)", () => {
    // "Weekly Diamond Pass" hanya ada sebagai nama produk di dalam Mobile
    // Legends. Kalau penyaringan dilakukan di browser atas ringkasan kartu
    // saja -- yang TIDAK memuat nama produk -- pencarian ini akan nihil.
    const h = halamanGrup(INDEKS, { page: 1, limit: 24, q: "weekly diamond" });
    assert.strictEqual(h.total, 1, "nama produk di dalam grup harus ikut terjangkau");
    assert.strictEqual(h.items[0].name, "Mobile Legends");
});

test("mencari KODE SKU", () => {
    const h = halamanGrup(INDEKS, { page: 1, limit: 24, q: "PLN50" });
    assert.strictEqual(h.total, 1);
    assert.strictEqual(h.items[0].name, "PLN Token");
});

test("pencocokan multi-kata bersifat AND, bukan OR", () => {
    // "diamond" ada di Mobile Legends dan Free Fire; "172" hanya di ML.
    const semua = halamanGrup(INDEKS, { page: 1, limit: 24, q: "diamond" });
    assert.ok(semua.total >= 2, "kata tunggal harus mencocokkan beberapa grup");

    const sempit = halamanGrup(INDEKS, { page: 1, limit: 24, q: "diamond 172" });
    assert.strictEqual(sempit.total, 1, "semua token harus cocok (AND)");
    assert.strictEqual(sempit.items[0].name, "Mobile Legends");
});

test("pencarian tidak peduli huruf besar/kecil & spasi berlebih", () => {
    const a = halamanGrup(INDEKS, { page: 1, limit: 24, q: "  MOBILE   legends " });
    assert.strictEqual(a.total, 1);
    assert.strictEqual(a.items[0].name, "Mobile Legends");
});

test("hasil pencarian ikut terpaginasi dengan benar", () => {
    const h1 = halamanGrup(INDEKS, { page: 1, limit: 2, q: "diamond" });
    const h2 = halamanGrup(INDEKS, { page: 2, limit: 2, q: "diamond" });
    const gabungan = [...h1.items, ...h2.items].map((i) => i.id);
    assert.strictEqual(new Set(gabungan).size, gabungan.length, "kartu dobel antar halaman hasil pencarian");
    assert.strictEqual(h1.total, h2.total, "total hasil harus sama di semua halaman");
});

test("kata kunci tanpa hasil mengembalikan kosong, bukan seluruh katalog", () => {
    const h = halamanGrup(INDEKS, { page: 1, limit: 24, q: "produk-yang-tidak-ada-xyz" });
    assert.strictEqual(h.total, 0);
    assert.strictEqual(h.items.length, 0);
});

// -------------------------------------------------------------
// C. FILTER KATEGORI
// -------------------------------------------------------------
console.log("\nC. Filter kategori\n");

test("filter kategori menyaring dengan benar", () => {
    const h = halamanGrup(INDEKS, { page: 1, limit: 24, kategori: "Topup Game" });
    assert.strictEqual(h.total, 4);
    assert.ok(h.items.every((i) => i.category === "Topup Game"));
});

test('kategori "all" / kosong tidak menyaring apa pun', () => {
    assert.strictEqual(halamanGrup(INDEKS, { page: 1, limit: 24, kategori: "all" }).total, INDEKS.length);
    assert.strictEqual(halamanGrup(INDEKS, { page: 1, limit: 24, kategori: "" }).total, INDEKS.length);
});

test("kategori dan pencarian berlaku bersamaan", () => {
    const h = halamanGrup(INDEKS, { page: 1, limit: 24, kategori: "Topup Game", q: "diamond" });
    assert.ok(h.total >= 1);
    assert.ok(h.items.every((i) => i.category === "Topup Game"));

    // "DANA" cocok kata kunci tapi kategorinya E-Money -> harus tersaring.
    const kosong = halamanGrup(INDEKS, { page: 1, limit: 24, kategori: "Topup Game", q: "saldo dana" });
    assert.strictEqual(kosong.total, 0, "filter kategori harus tetap berlaku saat mencari");
});

// -------------------------------------------------------------
// D. URUTAN GAME POPULER
// -------------------------------------------------------------
console.log("\nD. Urutan game populer\n");

test("game populer muncul di halaman pertama sesuai urutan yang ditetapkan", () => {
    const urutan = ["mobile legends", "pubg", "free fire", "call of duty", "genshin"];
    const diurutkan = urutkanPopuler(INDEKS.filter((g) => g.category === "Topup Game").slice(), urutan);
    const nama = diurutkan.map((g) => g.name);

    assert.strictEqual(nama[0], "Mobile Legends");
    assert.strictEqual(nama[1], "PUBG Mobile");
    assert.strictEqual(nama[2], "Free Fire");
    assert.strictEqual(nama[3], "Genshin Impact");
});

test("pengurutan populer dilakukan SEBELUM paginasi", () => {
    // Kalau diurutkan setelah dipotong, halaman 1 belum tentu berisi game
    // terpopuler -- justru itu yang membuat urutan populer jadi tidak ada
    // artinya begitu daftarnya dipecah per halaman.
    const urutan = ["mobile legends", "pubg"];
    const diurutkan = urutkanPopuler(INDEKS.slice(), urutan);
    const h = halamanGrup(diurutkan, { page: 1, limit: 2 });
    assert.deepStrictEqual(h.items.map((i) => i.name), ["Mobile Legends", "PUBG Mobile"]);
});

test("pencarian mengabaikan ranking populer dan mendahulukan nama game yang cocok", () => {
    const gamePopuler = buatGrup("mobile-legends", "Mobile Legends", "Topup Game", [
        { nama: "Voucher Minecraft Bonus", kode: "ML-MINECRAFT", harga: 15000 }
    ]);
    const minecraft = buatGrup("minecraft", "Minecraft", "Topup Game", [
        { nama: "Minecoins 1720", kode: "MC1720", harga: 100000 }
    ]);

    // Dalam mode beranda Mobile Legends memang menang ranking populer.
    const populer = urutkanPopuler([minecraft, gamePopuler], ["mobile legends"]);
    assert.strictEqual(populer[0].name, "Mobile Legends");

    // Dalam mode pencarian, kecocokan nama Minecraft harus menang meskipun
    // Mobile Legends juga cocok lewat salah satu nama produknya.
    const dicari = urutkanPencarian([gamePopuler, minecraft], "minecraft");
    const h = halamanGrup(dicari, { page: 1, limit: 20, q: "minecraft" });
    assert.deepStrictEqual(h.items.map((i) => i.name), ["Minecraft", "Mobile Legends"]);
});

// -------------------------------------------------------------
// E. RINGKASAN KARTU
// -------------------------------------------------------------
console.log("\nE. Isi ringkasan kartu\n");

test("ringkasan memuat jumlah produk & harga termurah, TANPA daftar produk", () => {
    const h = halamanGrup(INDEKS, { page: 1, limit: 1, q: "mobile legends" });
    const kartu = h.items[0];

    assert.strictEqual(kartu.product_count, 3);
    assert.strictEqual(kartu.min_price, 20000, "harga termurah harus 20.000");
    // Inti penghematan payload: daftar produk TIDAK ikut terkirim.
    assert.strictEqual(kartu.products, undefined, "daftar produk tidak boleh ikut di ringkasan kartu");
});

test("ringkasan tidak pernah membocorkan harga modal", () => {
    const h = halamanGrup(INDEKS, { page: 1, limit: 24 });
    for (const kartu of h.items) {
        assert.strictEqual(kartu.harga_beli, undefined, "harga_beli bocor ke ringkasan kartu");
    }
});

// -------------------------------------------------------------
// F. KONTRAK UI: 20 KARTU + TOMBOL EKSPLISIT
// -------------------------------------------------------------
console.log("\nF. Kontrak render ringan di frontend\n");

const frontendDir = path.join(__dirname, "..", "nexshop-frontend");
const storefrontSource = fs.readFileSync(path.join(frontendDir, "script.js"), "utf8").replace(/\r\n/g, "\n");
const marketplaceSource = fs.readFileSync(path.join(frontendDir, "marketplace.html"), "utf8").replace(/\r\n/g, "\n");
const topupControlStart = storefrontSource.indexOf('KONTROL "TAMPILKAN SEMUA"');
const topupControlEnd = storefrontSource.indexOf("function setTopupLoadMoreState", topupControlStart);
const topupControlSource = storefrontSource.slice(topupControlStart, topupControlEnd);

test("Topup merender batch awal tepat 20 kartu", () => {
    assert.ok(storefrontSource.includes("const TOPUP_PAGE_SIZE = 20;"));
});

test("Topup tidak auto-render sisanya lewat IntersectionObserver", () => {
    assert.ok(topupControlStart >= 0 && topupControlEnd > topupControlStart, "blok kontrol Topup tidak ditemukan");
    assert.ok(!topupControlSource.includes("IntersectionObserver"), "Topup tidak boleh auto-load saat discroll");
    assert.ok(topupControlSource.includes('btn.addEventListener("click", loadAllTopupProducts)'));
});

test("Tampilkan Semua mengambil batch server lalu merender sekali setelah lengkap", () => {
    assert.ok(storefrontSource.includes('limit: "60"'));
    assert.ok(storefrontSource.includes("TOPUP_GAMES = mapTopupSummaryItems(semuaItem)"));
    assert.ok(storefrontSource.includes("querySnapshot !== topupSearchQuery.trim()"), "hasil query lama harus dibuang");
});

test("kartu populer langsung disingkirkan saat pengguna mulai mencari", () => {
    assert.ok(storefrontSource.includes("function renderTopupSearchPending()"));
    assert.ok(
        storefrontSource.includes('topupSearchQuery = e.target.value;\n            renderTopupSearchPending();'),
        "input pencarian harus menonaktifkan kartu lama sebelum menunggu debounce"
    );
    assert.ok(storefrontSource.includes('countBadge.textContent = "Mencari…"'));
});

test("Marketplace menyediakan pencarian produk di dalam operator", () => {
    assert.ok(marketplaceSource.includes('id="mktDetailSearchInput"'));
    assert.ok(marketplaceSource.includes("function filterMarketplaceDetailProducts"));
    assert.ok(marketplaceSource.includes("[p.nama, p.kode_produk, p.harga_jual]"));
});

test("filter detail menemukan produk yang berada jauh setelah 20 item pertama", () => {
    const produk = Array.from({ length: 45 }, (_, i) => ({
        nama: i === 37 ? "PDAM Kota Bandung" : `PDAM Wilayah ${i + 1}`,
        kode_produk: i === 37 ? "PDAMBANDUNG" : `PDAM${i + 1}`
    }));
    const tokens = "bandung".split(/\s+/);
    const hasil = produk.filter((p) => {
        const text = `${p.nama} ${p.kode_produk}`.toLowerCase();
        return tokens.every((token) => text.includes(token));
    });
    assert.strictEqual(hasil.length, 1);
    assert.strictEqual(hasil[0].kode_produk, "PDAMBANDUNG");
});

console.log("");
console.log("===============================================================================");
console.log("  RINGKASAN: " + passed + "/" + total + " pengujian lolos.");
console.log("===============================================================================");

if (passed !== total) process.exitCode = 1;
