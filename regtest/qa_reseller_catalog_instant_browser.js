"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const puppeteer = require(path.join(__dirname, "..", "nexshop-backend", "node_modules", "puppeteer-core"));

const root = path.join(__dirname, "..");
const frontend = path.join(root, "nexshop-frontend");
const chrome = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe"
].find(fs.existsSync);
const TOTAL = 600;
const PAGE_SIZE = 100;
const products = Array.from({ length: TOTAL }, (_, index) => ({
    id: index + 1,
    kode_produk: `SKU-${String(index + 1).padStart(4, "0")}`,
    nama: `Produk Reseller ${index + 1}`,
    kategori: index % 2 ? "Voucher Game" : "Topup Game",
    operator: index % 3 ? "Operator A" : "Operator B",
    harga_normal: 20000 + index,
    harga_modal_reseller: 19000 + index,
    diskon_persen: 2,
    butuh_server_id: false,
    status: "tersedia",
    operator_logo: "/images/nexshop-logo.webp",
    item_icon: "/images/nexshop-logo.webp"
}));

const overview = {
    user: {
        id: "fixture-reseller-1",
        reseller_status: "approved",
        reseller_tier: { code: "silver", name: "Silver", discount_percent: 2 },
        fullname: "Fixture Mitra",
        email: "fixture@example.test",
        phone: "081234567890",
        member_code: "NX-FIXTURE",
        balance: 100000
    },
    metrics: {},
    security_indicator: {},
    news: []
};

function serve() {
    let activeCatalogRequests = 0;
    let maxCatalogConcurrency = 0;
    let catalogResponses = 0;
    let slowRefresh = false;

    const server = http.createServer((req, res) => {
        const url = new URL(req.url, "http://127.0.0.1");
        if (url.pathname === "/api/reseller/portal/overview") {
            res.writeHead(200, { "content-type": "application/json" });
            return res.end(JSON.stringify(overview));
        }
        if (url.pathname === "/api/reseller/portal/products") {
            activeCatalogRequests += 1;
            maxCatalogConcurrency = Math.max(maxCatalogConcurrency, activeCatalogRequests);
            const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
            const start = (page - 1) * PAGE_SIZE;
            const slice = products.slice(start, start + PAGE_SIZE);
            const delay = slowRefresh ? 1200 : (page === 1 ? 80 : 650);
            return setTimeout(() => {
                activeCatalogRequests -= 1;
                catalogResponses += 1;
                res.writeHead(200, { "content-type": "application/json" });
                res.end(JSON.stringify({
                    products: slice,
                    total_products: TOTAL,
                    page,
                    limit: PAGE_SIZE,
                    total_pages: Math.ceil(TOTAL / PAGE_SIZE),
                    has_more: start + slice.length < TOTAL,
                    facets: { categories: [], operators: [] }
                }));
            }, delay);
        }

        const clean = url.pathname === "/portal-reseller" ? "/portal-reseller.html" : url.pathname;
        const file = path.resolve(frontend, `.${clean}`);
        if (!file.startsWith(frontend) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
            res.writeHead(404);
            return res.end("not found");
        }
        const ext = path.extname(file);
        const contentType = ext === ".html" ? "text/html" : ext === ".css" ? "text/css" : ext === ".js" ? "application/javascript" : "application/octet-stream";
        const headers = { "content-type": contentType };
        if (ext === ".html") {
            headers["content-security-policy"] = "default-src 'self' data:; script-src 'self' 'unsafe-inline'; script-src-attr 'none'; style-src 'self' 'unsafe-inline'; style-src-attr 'none'; img-src 'self' data:; connect-src 'self'; font-src 'self' data:; frame-src 'none'; object-src 'none'";
        }
        res.writeHead(200, headers);
        res.end(fs.readFileSync(file));
    });

    return {
        server,
        stats: () => ({ maxCatalogConcurrency, catalogResponses }),
        enableSlowRefresh: () => { slowRefresh = true; catalogResponses = 0; }
    };
}

(async () => {
    if (!chrome) throw new Error("Chrome/Edge executable tidak ditemukan");
    const fixture = serve();
    await new Promise((resolve) => fixture.server.listen(0, "127.0.0.1", resolve));
    const port = fixture.server.address().port;
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox"] });
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
        await page.goto(`http://127.0.0.1:${port}/portal-reseller`, { waitUntil: "domcontentloaded" });
        await page.evaluate(() => sessionStorage.setItem("nexshop-reseller-token", "fixture-portal-token"));
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForFunction(() => getComputedStyle(document.querySelector("#sectionDashboard")).display === "flex", { timeout: 10000 });

        const startedAt = Date.now();
        await page.evaluate(() => window.switchConsoleView("view-products"));
        await page.waitForSelector("#tvProductsGridView .tv-product-card-item", { timeout: 10000 });
        const firstCardMs = Date.now() - startedAt;
        if (firstCardMs >= 600) throw new Error(`first card terlambat: ${firstCardMs}ms`);

        await page.waitForFunction((total) => document.querySelector("#tvProductCatalogProgress")?.textContent.includes(`${total} produk NexShop tersedia`), { timeout: 5000 }, TOTAL);
        const settled = await page.evaluate(() => ({
            gridCards: document.querySelectorAll("#tvProductsGridView .tv-product-card-item").length,
            tableRows: document.querySelectorAll("#tvProductsTableBody tr").length,
            hasLoadMore: Boolean(document.querySelector("#tvProductRenderMoreButton")),
            progress: document.querySelector("#tvProductCatalogProgress")?.textContent || ""
        }));
        if (settled.gridCards > 48) throw new Error(`DOM grid membengkak: ${settled.gridCards} card dirender sekaligus`);
        if (settled.tableRows !== 0) throw new Error(`tabel tersembunyi ikut dirender: ${settled.tableRows} row`);
        if (!settled.hasLoadMore) throw new Error("kontrol muat produk berikutnya tidak tersedia");
        if (fixture.stats().maxCatalogConcurrency > 4) throw new Error(`concurrency fetch tidak dibatasi: ${fixture.stats().maxCatalogConcurrency}`);

        fixture.enableSlowRefresh();
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForFunction(() => getComputedStyle(document.querySelector("#sectionDashboard")).display === "flex", { timeout: 10000 });
        const cacheStartedAt = Date.now();
        await page.evaluate(() => window.switchConsoleView("view-products"));
        await page.waitForSelector("#tvProductsGridView .tv-product-card-item", { timeout: 300 });
        const cachePaintMs = Date.now() - cacheStartedAt;
        if (cachePaintMs >= 300) throw new Error(`cache-first paint terlambat: ${cachePaintMs}ms`);
        if (fixture.stats().catalogResponses !== 0) throw new Error("assertion cache-first baru berjalan setelah respons jaringan");

        console.log(`PASS qa_reseller_catalog_instant_browser: first=${firstCardMs}ms cache=${cachePaintMs}ms cards=${settled.gridCards} concurrency=${fixture.stats().maxCatalogConcurrency}`);
    } finally {
        await browser.close();
        await new Promise((resolve) => fixture.server.close(resolve));
    }
})().catch((error) => {
    console.error(`FAIL qa_reseller_catalog_instant_browser: ${error.message}`);
    process.exit(1);
});
