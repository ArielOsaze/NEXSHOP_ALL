"use strict";

// QA browser opsional untuk Marketplace. Script skip dengan sukses bila Chrome
// tidak tersedia (misalnya CI Linux minimal), tetapi menjalankan pemeriksaan
// viewport mobile + desktop ketika browser lokal ada.
const fs = require("fs");
const http = require("http");
const path = require("path");
const puppeteer = require(path.join(__dirname, "..", "nexshop-backend", "node_modules", "puppeteer-core"));

const chromeCandidates = process.platform === "win32" ? [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
] : ["/usr/bin/google-chrome-stable", "/usr/bin/google-chrome", "/usr/bin/chromium"];
const executablePath = chromeCandidates.find(fs.existsSync);
if (!executablePath) {
    console.log("SKIP: Chrome/Chromium tidak ditemukan untuk QA Marketplace.");
    process.exit(0);
}

const frontend = path.join(__dirname, "..", "nexshop-frontend");
const mime = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png" };
const items = Array.from({ length: 35 }, (_, index) => ({
    id: `operator-${index + 1}`,
    name: index === 0 ? "PDAM Kota Bandung" : `Layanan Digital ${index + 1}`,
    category: index < 10 ? "Tagihan" : index < 20 ? "E-Wallet" : "Pulsa",
    logo: null,
    product_count: 8 + index,
    min_price: 10000 + index * 500
}));

function json(res, body) {
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1:3000");
    if (url.pathname === "/api/topup/catalog/operators") {
        const q = String(url.searchParams.get("q") || "").toLowerCase();
        const category = String(url.searchParams.get("kategori") || "").toLowerCase();
        const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
        let result = items.filter((item) => (!q || item.name.toLowerCase().includes(q)) && (!category || item.category.toLowerCase() === category));
        const start = (page - 1) * 20;
        return json(res, {
            items: result.slice(start, start + 20), page, total: result.length,
            has_more: start + 20 < result.length,
            total_operators: items.length,
            categories: [{ name: "Tagihan", count: 10 }, { name: "E-Wallet", count: 10 }, { name: "Pulsa", count: 15 }]
        });
    }
    if (url.pathname === "/api/settings/store") return json(res, { store_name: "NexShop", contact_whatsapp: "628123456789" });
    if (url.pathname.startsWith("/api/")) return json(res, {});

    let relative = decodeURIComponent(url.pathname.replace(/^\//, ""));
    if (!relative || relative === "marketplace") relative = "marketplace.html";
    const target = path.resolve(frontend, relative);
    if (!target.startsWith(frontend) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
        res.writeHead(404); return res.end("Not found");
    }
    res.writeHead(200, { "Content-Type": mime[path.extname(target)] || "application/octet-stream" });
    fs.createReadStream(target).pipe(res);
});

(async () => {
    await new Promise((resolve) => server.listen(3000, "127.0.0.1", resolve));
    const browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
    try {
        for (const viewport of [{ width: 375, height: 812, name: "mobile" }, { width: 1440, height: 900, name: "desktop" }]) {
            const page = await browser.newPage();
            await page.setViewport(viewport);
            await page.evaluateOnNewDocument(() => localStorage.setItem("nexshop_cookie_consent", "v1.all"));
            await page.goto("http://127.0.0.1:3000/marketplace", { waitUntil: "domcontentloaded", timeout: 30000 });
            await page.waitForSelector("button.market-card", { timeout: 15000 });
            const initial = await page.evaluate(() => ({
                cards: document.querySelectorAll(".market-card").length,
                overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
                cardTag: document.querySelector(".market-card")?.tagName,
                categoryHeight: Math.round(document.querySelector(".cat-btn")?.getBoundingClientRect().height || 0),
                quickActions: document.querySelectorAll(".mkt-banking-action").length,
                categoryLayout: getComputedStyle(document.getElementById("catFilterWrap")).display,
                categoryFirstRow: [...document.querySelectorAll(".cat-btn")].slice(0, 4)
                    .map((button) => Math.round(button.getBoundingClientRect().top)),
                nexbotBackground: getComputedStyle(document.getElementById("nexbotFloatBtn")).backgroundImage,
                nexbotBackgroundColor: getComputedStyle(document.getElementById("nexbotFloatBtn")).backgroundColor
            }));
            if (initial.cards !== 20 || initial.overflow || initial.cardTag !== "BUTTON") throw new Error(`${viewport.name}: render awal/overflow/kartu tidak valid ${JSON.stringify(initial)}`);
            if (initial.quickActions !== 4 || initial.categoryLayout !== "grid") throw new Error(`${viewport.name}: dashboard banking tidak valid ${JSON.stringify(initial)}`);
            if (initial.nexbotBackground !== "none" || initial.nexbotBackgroundColor !== "rgba(0, 0, 0, 0)") throw new Error(`${viewport.name}: tombol NexBot belum transparan ${JSON.stringify(initial)}`);
            if (viewport.name === "mobile" && initial.categoryHeight < 44) throw new Error(`mobile: target kategori hanya ${initial.categoryHeight}px`);
            if (viewport.name === "mobile" && new Set(initial.categoryFirstRow).size !== 1) throw new Error(`mobile: empat shortcut kategori pertama tidak satu baris`);

            await page.click("#mktLoadMoreBtn");
            await page.waitForFunction(() => document.querySelectorAll(".market-card").length === 35);
            await page.waitForFunction(() => document.activeElement?.classList.contains("market-card"), { timeout: 3000 });

            await page.type("#mktSearchInput", "PDAM");
            await page.waitForFunction(() => document.querySelectorAll(".market-card").length === 1);
            const query = await page.evaluate(() => new URLSearchParams(location.search).get("q"));
            if (query !== "PDAM") throw new Error(`${viewport.name}: state pencarian tidak tersimpan di URL`);
            if (process.env.QA_SCREENSHOT_DIR) {
                fs.mkdirSync(process.env.QA_SCREENSHOT_DIR, { recursive: true });
                await page.screenshot({ path: path.join(process.env.QA_SCREENSHOT_DIR, `marketplace-${viewport.name}.png`), fullPage: true });
            }
            await page.close();
            console.log(`PASS Marketplace ${viewport.name}: 20→35, search, focus, no-overflow`);
        }
    } finally {
        await browser.close();
        server.close();
    }
})().catch((error) => {
    console.error("FAIL Marketplace browser QA:", error.message);
    server.close();
    process.exit(1);
});
