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

function serve() {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            const pathname = new URL(req.url, "http://localhost").pathname;
            const clean = pathname === "/portal-reseller" ? "/portal-reseller.html" : pathname;
            const file = path.resolve(frontend, `.${clean}`);
            if (!file.startsWith(frontend) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
                res.writeHead(404);
                return res.end("not found");
            }
            const ext = path.extname(file);
            const contentType = ext === ".html" ? "text/html" : ext === ".css" ? "text/css" : ext === ".js" ? "application/javascript" : "application/octet-stream";
            res.writeHead(200, { "content-type": contentType });
            res.end(fs.readFileSync(file));
        });
        server.listen(0, "127.0.0.1", () => resolve(server));
    });
}

const overview = {
    user: {
        reseller_status: "pending",
        reseller_tier: null,
        fullname: "Demo Mitra",
        email: "demo@example.test",
        phone: "",
        member_code: null,
        balance: 0
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

const tiers = [
    { code: "silver", name: "Silver", discount_percent: 2, description: "Tingkat awal.", eligibility: { requirement: "Belum ada minimum transaksi bulanan." } },
    { code: "gold", name: "Gold", discount_percent: 3.5, description: "Transaksi rutin.", eligibility: { requirement: "Rata-rata transaksi per bulan minimal Rp50.000.000." } },
    { code: "platinum", name: "Platinum", discount_percent: 5, description: "Volume besar.", eligibility: { requirement: "Rata-rata transaksi per bulan di atas Rp100.000.000." } }
];

(async () => {
    if (!chrome) throw new Error("Chrome/Edge executable tidak ditemukan");
    const server = await serve();
    const port = server.address().port;
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox"] });
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
        await page.setRequestInterception(true);
        page.on("request", (request) => {
            const url = new URL(request.url());
            if (url.pathname === "/api/reseller/portal/overview") {
                return request.respond({ status: 200, contentType: "application/json", body: JSON.stringify(overview) });
            }
            if (url.pathname === "/api/reseller/tiers") {
                return request.respond({ status: 200, contentType: "application/json", body: JSON.stringify(tiers) });
            }
            if (url.pathname.startsWith("/api/")) {
                return request.respond({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
            }
            return request.continue();
        });

        const url = `http://127.0.0.1:${port}/portal-reseller`;
        await page.goto(url, { waitUntil: "domcontentloaded" });
        await page.evaluate(() => sessionStorage.setItem("nexshop-reseller-token", "portal-fixture-token"));
        await page.reload({ waitUntil: "networkidle0" });
        await page.waitForFunction(() => getComputedStyle(document.querySelector("#sectionDashboard")).display !== "none", { timeout: 10000 });

        const pendingState = await page.evaluate(() => {
            const banner = document.querySelector("#tvPendingBanner");
            const heading = banner?.querySelector('[data-csp-style="sb687a22b9ac446"]');
            const body = banner?.querySelector('[data-csp-style="sbe0deb3f9b02a8"]');
            return {
                bannerDisplay: banner ? getComputedStyle(banner).display : "none",
                headingColor: heading ? getComputedStyle(heading).color : "",
                bodyColor: body ? getComputedStyle(body).color : "",
                documentWidth: document.documentElement.scrollWidth,
                viewportWidth: innerWidth
            };
        });
        if (pendingState.bannerDisplay !== "flex") throw new Error(`pending banner tidak tampil: ${JSON.stringify(pendingState)}`);
        if (/255,\s*255,\s*255/.test(`${pendingState.headingColor} ${pendingState.bodyColor}`)) throw new Error(`pending banner masih memakai teks putih: ${JSON.stringify(pendingState)}`);
        if (pendingState.documentWidth > pendingState.viewportWidth + 1) throw new Error(`portal mobile overflow: ${JSON.stringify(pendingState)}`);

        await page.evaluate(() => window.switchConsoleView("view-tiers"));
        await page.waitForFunction(() => document.querySelectorAll("#tvTierGrid .tv-tier-requirement").length === 3, { timeout: 10000 });
        const tierState = await page.$$eval("#tvTierGrid .tv-tier-requirement", (nodes) => nodes.map((node) => node.textContent.trim()));
        const expected = ["Belum ada minimum transaksi bulanan.", "Rata-rata transaksi per bulan minimal Rp50.000.000.", "Rata-rata transaksi per bulan di atas Rp100.000.000."];
        if (JSON.stringify(tierState) !== JSON.stringify(expected)) throw new Error(`Portal tier requirement mismatch: ${JSON.stringify(tierState)}`);

        const tierVisualState = await page.$$eval("#tvTierGrid .tv-portal-tier-card", (nodes) => nodes.map((node) => {
            const style = getComputedStyle(node);
            return {
                className: [...node.classList].find((name) => name.startsWith("tv-tier-")),
                top: style.borderTopColor,
                background: style.backgroundImage
            };
        }));
        const silverVisual = tierVisualState.find((tier) => tier.className === "tv-tier-silver");
        const platinumVisual = tierVisualState.find((tier) => tier.className === "tv-tier-platinum");
        if (!silverVisual || !platinumVisual || silverVisual.top === platinumVisual.top || silverVisual.background === platinumVisual.background) {
            throw new Error(`Portal Silver dan Platinum masih memakai visual yang sama: ${JSON.stringify(tierVisualState)}`);
        }
        await page.screenshot({ path: path.join(__dirname, "qa_portal_tier_palette_390.png"), fullPage: false });
        await page.$eval("#view-tiers", (element) => element.scrollIntoView({ block: "start", behavior: "instant" }));
        await new Promise((resolve) => setTimeout(resolve, 250));
        await page.screenshot({ path: path.join(__dirname, "qa_portal_tier_palette_viewport_390.png"), fullPage: false });

        console.log("PASS qa_portal_tier_notice_browser: pending notice readable and Silver/Gold/Platinum transaction requirements render with distinct palettes");
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
})().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
});
