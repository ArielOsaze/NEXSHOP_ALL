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

const fixtureProducts = [
    { id: 1, kode_produk: "ML86", nama: "Mobile Legends 86 Diamond", kategori: "Topup Game", operator: "Mobile Legends", harga_normal: 20000, harga_modal_reseller: 18000, diskon_persen: 2, butuh_server_id: true, status: "tersedia", operator_logo: "/images/nexshop-logo.webp", item_icon: "/images/nexshop-logo.webp" },
    { id: 2, kode_produk: "VCH10", nama: "Voucher Game Rp10.000", kategori: "Voucher Game", operator: "Voucher Game", harga_normal: 10000, harga_modal_reseller: 9500, diskon_persen: 2, butuh_server_id: false, status: "tersedia", operator_logo: "/images/nexshop-logo.webp", item_icon: "/images/nexshop-logo.webp" }
];

function serve() {
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, "http://127.0.0.1");
        if (url.pathname === "/api/reseller/portal/overview") {
            res.writeHead(200, { "content-type": "application/json" });
            return res.end(JSON.stringify({ user: { reseller_status: "approved", reseller_tier: "silver", fullname: "Fixture", email: "fixture@example.test", phone: "081234567890", phone_normalized: "6281234567890", member_code: "NX-FIXTURE", balance: 100000 }, metrics: { today: { count: 0, amount: 0 }, yesterday: { count: 0, amount: 0 }, this_month: { count: 0, amount: 0 }, last_month: { count: 0, amount: 0 } }, indicators: {}, products: [], orders: [], news: [] }));
        }
        if (url.pathname === "/api/reseller/portal/products") {
            res.writeHead(200, { "content-type": "application/json" });
            return res.end(JSON.stringify({ products: fixtureProducts, total_products: fixtureProducts.length }));
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
        if (ext === ".html") headers["content-security-policy"] = "default-src 'self' data:; script-src 'self' 'unsafe-inline'; script-src-attr 'none'; style-src 'self' 'unsafe-inline'; style-src-attr 'none'; img-src 'self' data:; connect-src 'self'; font-src 'self' data:; frame-src 'none'; object-src 'none'";
        res.writeHead(200, headers);
        res.end(fs.readFileSync(file));
    });
    return server;
}

(async () => {
    if (!chrome) throw new Error("Chrome/Edge executable tidak ditemukan");
    const server = serve();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox"] });
    const results = [];
    try {
        const page = await browser.newPage();
        for (const width of [320, 360, 390, 768, 1024, 1440]) {
            await page.setViewport({ width, height: 844, deviceScaleFactor: 1 });
            await page.goto(`http://127.0.0.1:${port}/portal-reseller?viewport=${width}`, { waitUntil: "domcontentloaded" });
            await page.evaluate(() => sessionStorage.setItem("nexshop-reseller-token", "fixture-portal-token"));
            await page.reload({ waitUntil: "networkidle0" });
            await page.waitForFunction(() => getComputedStyle(document.querySelector("#sectionDashboard")).display === "flex", { timeout: 10000 });
            await page.evaluate(() => window.switchConsoleView("view-products"));
            await page.waitForFunction(() => document.querySelectorAll("#tvCategoryTabsScroll .tv-cat-tab-btn").length === 3, { timeout: 10000 });
            await page.evaluate(() => document.querySelector('#tvCategoryTabsScroll .tv-cat-tab-btn[data-category-index="2"]')?.scrollIntoView({ inline: "center", block: "nearest" }));
            const state = await page.evaluate(() => {
                const button = document.querySelector('#tvCategoryTabsScroll .tv-cat-tab-btn[data-category-index="2"]');
                const rect = button?.getBoundingClientRect();
                const hit = rect ? document.elementFromPoint(rect.left + Math.min(rect.width / 2, 30), rect.top + rect.height / 2) : null;
                return { viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth, categoryButtons: document.querySelectorAll("#tvCategoryTabsScroll .tv-cat-tab-btn").length, hitMatches: hit === button || button?.contains(hit) };
            });
            if (state.scrollWidth > width + 2) throw new Error(`horizontal overflow at ${width}px: ${JSON.stringify(state)}`);
            if (!state.hitMatches) throw new Error(`category hit-test failed at ${width}px: ${JSON.stringify(state)}`);
            results.push(`${width}px:ok`);
        }
        console.log(`PASS qa_reseller_portal_viewports: ${results.join(", ")}`);
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
})().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
});
