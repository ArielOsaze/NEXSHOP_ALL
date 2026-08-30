"use strict";

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
    console.log("SKIP: Chrome/Chromium tidak ditemukan untuk QA kartu Instagram News.");
    process.exit(0);
}

const frontend = path.join(__dirname, "..", "nexshop-frontend");
const mime = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".webp": "image/webp", ".ico": "image/x-icon" };
const article = {
    slug: "qa-instagram-card",
    title: "Game Baru yang Wajib Dicoba Tahun Ini",
    excerpt: "Ringkasan berita gaming terbaru dari NexShop News untuk komunitas Indonesia.",
    category: "Gaming",
    author: "NexShop Editorial",
    published_at: "2026-08-30T08:00:00.000Z",
    updated_at: "2026-08-30T08:00:00.000Z",
    image_url: "/images/nexshop-logo.webp",
    image_alt: "Logo NexShop",
    content: "<p>Konten artikel QA untuk memverifikasi kartu share visual.</p>",
    tags: [],
    sources: [],
    related: [],
    view_count: 0
};

const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1:3011");
    if (url.pathname === "/api/news/articles/qa-instagram-card") {
        res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        return res.end(JSON.stringify({ data: article }));
    }
    let relative = decodeURIComponent(url.pathname.replace(/^\//, ""));
    if (relative === "berita/qa-instagram-card") relative = "berita-artikel.html";
    const target = path.resolve(frontend, relative || "index.html");
    if (!target.startsWith(frontend) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
        res.writeHead(404);
        return res.end("Not found");
    }
    res.writeHead(200, { "Content-Type": mime[path.extname(target)] || "application/octet-stream", "Access-Control-Allow-Origin": "*" });
    fs.createReadStream(target).pipe(res);
});

(async () => {
    await new Promise((resolve) => server.listen(3011, "127.0.0.1", resolve));
    const browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
        await page.setRequestInterception(true);
        page.on("request", (request) => {
            if (request.url() === "http://localhost:3000/api/news/articles/qa-instagram-card") {
                return request.respond({
                    status: 200,
                    contentType: "application/json",
                    headers: { "Access-Control-Allow-Origin": "*" },
                    body: JSON.stringify({ data: article })
                });
            }
            return request.continue();
        });
        await page.goto("http://127.0.0.1:3011/berita/qa-instagram-card", { waitUntil: "networkidle0", timeout: 30000 });
        await page.waitForSelector("#instagramShareCardBtn");
        const state = await page.evaluate(() => ({
            button: document.getElementById("instagramShareCardBtn")?.textContent.trim(),
            stylesheet: Boolean(document.querySelector('link[href*="news-instagram-card.css?v=20260830-news-instagram-card-1"]')),
            runtime: Boolean(document.querySelector('script[src*="news-instagram-card.js?v=20260830-news-instagram-card-2"]')),
            title: document.querySelector('[itemprop="headline"]')?.textContent.trim(),
            canonical: document.querySelector('link[rel="canonical"]')?.href
        }));
        if (state.button !== "Kartu Instagram" || !state.stylesheet || !state.runtime || state.title !== article.title || !state.canonical.includes("/berita/qa-instagram-card")) {
            throw new Error(`kontrol/share metadata tidak sesuai: ${JSON.stringify(state)}`);
        }

        await page.evaluate(() => {
            Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
            Object.defineProperty(navigator, "share", {
                configurable: true,
                value: async (data) => {
                    window.__sharePayload = {
                        title: data.title,
                        text: data.text,
                        url: data.url,
                        files: data.files?.map((file) => ({ name: file.name, type: file.type, size: file.size })) || []
                    };
                    if (data.files?.[0]) {
                        const bitmap = await createImageBitmap(data.files[0]);
                        window.__sharePayload.dimensions = { width: bitmap.width, height: bitmap.height };
                        bitmap.close();
                    }
                }
            });
            document.getElementById("instagramShareCardBtn").click();
        });
        await page.waitForFunction(() => window.__sharePayload?.dimensions?.width === 1080, { timeout: 30000 });
        const shared = await page.evaluate(() => window.__sharePayload);
        if (shared.title !== article.title || !shared.text.includes("/berita/qa-instagram-card") || shared.url !== state.canonical || shared.files[0].type !== "image/png" || shared.files[0].size < 1000 || shared.dimensions.width !== 1080 || shared.dimensions.height !== 1920) {
            throw new Error(`payload native share bukan PNG 9:16 artikel: ${JSON.stringify(shared)}`);
        }
        console.log("PASS qa_news_instagram_card_browser: article renders SEO-backed 9:16 PNG share card and canonical native file-share payload");
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
})().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
});
