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
    {
        id: 1,
        kode_produk: "ML86",
        nama: "Mobile Legends 86 Diamond",
        kategori: "Topup Game",
        operator: "Mobile Legends",
        harga_normal: 20000,
        harga_modal_reseller: 18000,
        diskon_persen: 2,
        butuh_server_id: true,
        status: "tersedia",
        operator_logo: "/images/nexshop-logo.webp",
        item_icon: "/images/nexshop-logo.webp"
    },
    {
        id: 2,
        kode_produk: "VCH10",
        nama: "Voucher Game Rp10.000",
        kategori: "Voucher Game",
        operator: "Voucher Game",
        harga_normal: 10000,
        harga_modal_reseller: 9500,
        diskon_persen: 2,
        butuh_server_id: false,
        status: "tersedia",
        operator_logo: "/images/nexshop-logo.webp",
        item_icon: "/images/nexshop-logo.webp"
    }
];

const overview = {
    user: {
        reseller_status: "approved",
        reseller_tier: "silver",
        fullname: "Fixture Mitra",
        email: "fixture@example.test",
        phone: "081234567890",
        phone_normalized: "6281234567890",
        member_code: "NX-FIXTURE",
        balance: 100000
    },
    metrics: {
        today: { count: 0, amount: 0 },
        yesterday: { count: 0, amount: 0 },
        this_month: { count: 0, amount: 0 },
        last_month: { count: 0, amount: 0 }
    },
    indicators: { ip_whitelist_active: false, webhook_configured: false, two_factor_available: false },
    products: [],
    orders: [],
    news: []
};

function serve() {
    let checkoutBody = null;
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, "http://127.0.0.1");
        if (url.pathname === "/api/reseller/portal/overview") {
            res.writeHead(200, { "content-type": "application/json" });
            return res.end(JSON.stringify(overview));
        }
        if (url.pathname === "/api/reseller/portal/products") {
            res.writeHead(200, { "content-type": "application/json" });
            return res.end(JSON.stringify({ products: fixtureProducts, total_products: fixtureProducts.length }));
        }
        if (url.pathname === "/api/topup" && req.method === "POST") {
            let body = "";
            req.on("data", (chunk) => { body += chunk; });
            req.on("end", () => {
                checkoutBody = JSON.parse(body);
                res.writeHead(201, { "content-type": "application/json" });
                res.end(JSON.stringify({ order_id: "FIXTURE-ORDER", status: "processing", payment_method: "wallet" }));
            });
            return;
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
    return { server, getCheckoutBody: () => checkoutBody };
}

(async () => {
    if (!chrome) throw new Error("Chrome/Edge executable tidak ditemukan");
    const { server, getCheckoutBody } = serve();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox"] });
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
        await page.goto(`http://127.0.0.1:${port}/portal-reseller`, { waitUntil: "domcontentloaded" });
        await page.evaluate(() => sessionStorage.setItem("nexshop-reseller-token", "fixture-portal-token"));
        await page.reload({ waitUntil: "networkidle0" });
        await page.waitForFunction(() => getComputedStyle(document.querySelector("#sectionDashboard")).display === "flex", { timeout: 10000 });
        await page.evaluate(() => window.switchConsoleView("view-products"));
        await page.waitForFunction(() => document.querySelectorAll("#tvCategoryTabsScroll .tv-cat-tab-btn").length === 3, { timeout: 10000 });

        const browserErrors = [];
        page.on("pageerror", (error) => browserErrors.push(`pageerror: ${error.message}`));
        page.on("console", (message) => {
            if (message.type() === "error") browserErrors.push(`console: ${message.text()}`);
        });
        await page.click('#tvCategoryTabsScroll .tv-cat-tab-btn[data-category-index="2"]');
        await new Promise((resolve) => setTimeout(resolve, 250));
        const categoryState = await page.evaluate(() => ({
            activeButtons: Array.from(document.querySelectorAll("#tvCategoryTabsScroll .tv-cat-tab-btn.active")).map((node) => node.textContent.trim()),
            label: document.querySelector("#labelTotalFilteredProducts")?.textContent,
            cards: document.querySelectorAll("#tvProductsGridView .tv-product-card-item").length,
            buttons: Array.from(document.querySelectorAll("#tvCategoryTabsScroll .tv-cat-tab-btn")).map((node) => ({ text: node.textContent.trim(), listeners: node.dataset, rect: node.getBoundingClientRect().toJSON(), pointerEvents: getComputedStyle(node).pointerEvents, display: getComputedStyle(node).display })),
            targetHit: (() => { const node = document.querySelector('#tvCategoryTabsScroll .tv-cat-tab-btn[data-category-index="2"]'); if (!node) return null; const r = node.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + Math.min(r.width / 2, 30), r.top + r.height / 2); return { tag: hit?.tagName, className: hit?.className, text: hit?.textContent?.trim() }; })()
        }));
        if (categoryState.label !== "1 Produk Ditemukan") {
            throw new Error(`kategori tidak menyaring: ${JSON.stringify({ categoryState, browserErrors })}`);
        }

        await page.click("#tvProductsGridView .tv-btn-buy");
        await page.waitForFunction(() => document.querySelector("#portalPurchaseOverlay")?.hidden === false, { timeout: 3000 });
        await page.type("#portalPurchaseTarget", "081234567890");
        const checkoutRequest = new Promise((resolve) => {
            page.once("request", (request) => resolve(request.postData() ? JSON.parse(request.postData()) : null));
        });
        await page.click("#portalPurchaseSubmit");
        const checkout = await Promise.race([
            checkoutRequest,
            new Promise((resolve) => setTimeout(() => resolve(null), 5000))
        ]);
        if (!checkout) throw new Error("POST /api/topup tidak pernah dikirim");
        if (checkout.kode_produk !== "VCH10" || checkout.payment_method !== "wallet") {
            throw new Error(`payload checkout tidak sesuai: ${JSON.stringify(checkout)}`);
        }
        console.log("PASS qa_reseller_catalog_checkout_browser: kategori menyaring produk dan checkout wallet terbuka/terkirim di bawah CSP");
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
})().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
});
