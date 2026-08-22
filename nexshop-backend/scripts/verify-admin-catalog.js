// Verifikasi read-only endpoint admin katalog topup + statistik omzet.
//
// Beda dari simN_*.js lainnya, skrip ini KONEK KE DATABASE Supabase asli
// (baca doang, gak ada INSERT/UPDATE/DELETE sama sekali). Jalanin dari
// folder nexshop-backend supaya .env dan node_modules-nya kebaca:
//
//     cd nexshop-backend && node ../regtest/verify_admin_catalog.js
//
// Yang dijaga skrip ini: endpoint admin harus lihat SELURUH katalog
// (bukan cuma 1000 baris pertama batas default PostgREST), filter kategori
// harus balikin produk, angka ringkasan harus sama persis sama tabel, dan
// bucket tanggal grafik omzet harus pakai tanggal WIB.

require("dotenv").config({ quiet: true });

const topup = require("../controllers/topupController");
const stats = require("../controllers/statsController");

function mockRes(label) {
    return new Promise((resolve) => {
        const res = {
            statusCode: 200,
            status(code) { this.statusCode = code; return this; },
            json(payload) { resolve({ label, status: this.statusCode, payload }); },
            setHeader() { return this; },
            send(payload) { resolve({ label, status: this.statusCode, payload }); }
        };
        res._resolve = resolve;
        mockRes._last = res;
    });
}

function call(fn, req, label) {
    return new Promise((resolve) => {
        const res = {
            statusCode: 200,
            status(code) { this.statusCode = code; return this; },
            json(payload) { resolve({ label, status: this.statusCode, payload }); },
            setHeader() { return this; },
            send(payload) { resolve({ label, status: this.statusCode, payload }); }
        };
        fn(req, res).catch((err) => resolve({ label, status: 500, payload: { message: err.message } }));
    });
}

const admin = { user: { role: "admin", email: "verify@local" } };

(async () => {
    let failures = 0;
    const check = (name, ok, detail) => {
        console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
        if (!ok) failures += 1;
    };

    // 1. Ringkasan katalog harus lihat SELURUH produk, bukan 1000 pertama.
    const summary = await call(topup.getCatalogSummary, { ...admin, query: {} }, "catalog-summary");
    const total = summary.payload?.current?.total ?? 0;
    check("catalog-summary status 200", summary.status === 200, `status=${summary.status}`);
    check("catalog-summary lihat >1000 produk", total > 1000, `total=${total}`);

    const categories = Object.keys(summary.payload?.categories || {});
    check("catalog-summary punya kategori", categories.length > 0, categories.join(", "));

    // 2. Filter kategori di server harus balikin produk (dulu selalu 0).
    for (const cat of categories.slice(0, 4)) {
        const listed = await call(
            topup.getAllProductsAdmin,
            { ...admin, query: { category: cat, limit: "5" } },
            `products?category=${cat}`
        );
        const matched = listed.payload?.total ?? 0;
        const rows = listed.payload?.data?.length ?? 0;
        check(`filter kategori "${cat}" ada hasilnya`, matched > 0 && rows > 0, `total=${matched} rows=${rows}`);
    }

    // 3. Jumlah per kategori di ringkasan harus cocok sama endpoint produk.
    const firstCat = categories[0];
    if (firstCat) {
        const listed = await call(topup.getAllProductsAdmin, { ...admin, query: { category: firstCat, limit: "1" } }, "consistency");
        const fromList = listed.payload?.total ?? -1;
        const fromSummary = summary.payload.categories[firstCat].total;
        check("ringkasan & tabel konsisten", fromList === fromSummary, `tabel=${fromList} ringkasan=${fromSummary}`);
    }

    // 4. Operator ikut kekirim buat dropdown.
    if (firstCat) {
        const listed = await call(topup.getAllProductsAdmin, { ...admin, query: { category: firstCat, limit: "1" } }, "operators");
        const ops = listed.payload?.operators?.length ?? 0;
        check("daftar operator terisi", ops > 0, `operators=${ops}`);
    }

    // 5. Pencarian server-side.
    const search = await call(topup.getAllProductsAdmin, { ...admin, query: { q: "mobile legends", limit: "3" } }, "search");
    check("pencarian server-side jalan", (search.payload?.total ?? 0) > 0, `total=${search.payload?.total}`);

    // 6. Statistik: tren omzet 30 hari + 12 bulan lengkap dan pakai tanggal WIB.
    const overview = await call(stats.getOverview, { ...admin, query: {} }, "stats-overview");
    check("stats/overview status 200", overview.status === 200, `status=${overview.status}`);
    check("revenue_by_day 30 titik", overview.payload?.revenue_by_day?.length === 30, `len=${overview.payload?.revenue_by_day?.length}`);
    check("revenue_by_month 12 titik", overview.payload?.revenue_by_month?.length === 12, `len=${overview.payload?.revenue_by_month?.length}`);

    const days = overview.payload?.revenue_by_day || [];
    const todayWib = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
    check("hari terakhir grafik = hari ini WIB", days[days.length - 1]?.date === todayWib, `${days[days.length - 1]?.date} vs ${todayWib}`);
    check("tanggal grafik tidak ada yang invalid", days.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date)), "");

    const kategoriTerlaris = overview.payload?.top_topup_categories || [];
    const lainnya = kategoriTerlaris.find((k) => k.kategori === "Lainnya");
    console.log(`      kategori topup terlaris: ${kategoriTerlaris.map((k) => `${k.kategori}(${k.count})`).join(", ") || "belum ada order sukses"}`);
    check("order topup tidak semua jatuh ke \"Lainnya\"",
        kategoriTerlaris.length === 0 || !lainnya || kategoriTerlaris.length > 1 || lainnya.count === 0,
        lainnya ? `Lainnya=${lainnya.count}` : "tidak ada bucket Lainnya");

    console.log(`\n==== ${failures === 0 ? "SEMUA LOLOS" : failures + " GAGAL"} ====`);
    process.exit(failures === 0 ? 0 : 1);
})();
