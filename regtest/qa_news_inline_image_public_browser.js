"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const assert = require("assert");
const puppeteer = require(path.join(__dirname, "..", "nexshop-backend", "node_modules", "puppeteer-core"));

const chromeCandidates = process.platform === "win32" ? [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
] : ["/usr/bin/google-chrome-stable", "/usr/bin/google-chrome", "/usr/bin/chromium"];
const executablePath = chromeCandidates.find(fs.existsSync);
if (!executablePath) {
    console.log("SKIP: Chrome/Chromium tidak ditemukan untuk QA public inline image News.");
    process.exit(0);
}

const frontend = path.join(__dirname, "..", "nexshop-frontend");
const fixtureImage = fs.readFileSync(path.join(frontend, "images", "nexshop-logo.webp"));
const article = {
    slug: "qa-inline-image",
    title: "Berita dengan Foto Tengah",
    excerpt: "Fixture publik untuk memverifikasi foto inline.",
    category: "Gaming",
    author: "NexShop Editorial",
    published_at: "2026-08-30T08:00:00.000Z",
    updated_at: "2026-08-30T08:00:00.000Z",
    image_url: null,
    image_alt: null,
    content: "<p>Pembuka berita.</p><figure class=\"article-inline-image\"><img src=\"https://cdn.example.com/news/middle.webp\" alt=\"Foto tengah berita\" loading=\"lazy\"><figcaption>Keterangan foto</figcaption></figure><p>Penutup berita.</p>",
    tags: [],
    sources: [],
    related: [],
    view_count: 0
};

const mime = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".webp": "image/webp", ".ico": "image/x-icon" };
const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1:3013");
    if (url.pathname === "/api/news/articles/qa-inline-image") {
        res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        return res.end(JSON.stringify({ data: article }));
    }
    let relative = decodeURIComponent(url.pathname.replace(/^\//, ""));
    if (relative === "berita/qa-inline-image") relative = "berita-artikel.html";
    const target = path.resolve(frontend, relative || "index.html");
    if (!target.startsWith(frontend) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
        res.writeHead(404);
        return res.end("Not found");
    }
    res.writeHead(200, { "Content-Type": mime[path.extname(target)] || "application/octet-stream", "Access-Control-Allow-Origin": "*" });
    fs.createReadStream(target).pipe(res);
});

(async () => {
    await new Promise(resolve => server.listen(3013, "127.0.0.1", resolve));
    const browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
    try {
        const page = await browser.newPage();
        await page.setRequestInterception(true);
        page.on("console", message => console.log(`[browser:${message.type()}] ${message.text()}`));
        page.on("pageerror", error => console.error(`[browser:error] ${error.message}`));
        page.on("requestfailed", request => console.error(`[request-failed] ${request.url()} ${request.failure()?.errorText || ""}`));
        page.on("request", request => {
            if (request.url() === "https://cdn.example.com/news/middle.webp") {
                return request.respond({ status: 200, contentType: "image/webp", body: fixtureImage });
            }
            if (request.url().includes("/api/news/articles/qa-inline-image")) {
                return request.respond({
                    status: 200,
                    contentType: "application/json",
                    headers: { "Access-Control-Allow-Origin": "*" },
                    body: JSON.stringify({ data: article })
                });
            }
            return request.continue();
        });
        await page.goto("http://127.0.0.1:3013/berita/qa-inline-image", { waitUntil: "networkidle0", timeout: 30000 });
        await page.waitForSelector("#articleBodyContent .article-inline-image");
        const state = await page.evaluate(() => {
            const body = document.getElementById("articleBodyContent");
            const schemaData = JSON.parse(document.getElementById("jsonLdScript").textContent);
            return {
                children: [...body.children].map(node => node.tagName.toLowerCase()),
                src: body.querySelector(".article-inline-image img")?.src,
                alt: body.querySelector(".article-inline-image img")?.alt,
                loading: body.querySelector(".article-inline-image img")?.loading,
                caption: body.querySelector(".article-inline-image figcaption")?.textContent.trim(),
                schemaImages: schemaData[0]?.image || [],
                ogImage: document.getElementById("ogImage")?.content
            };
        });
        assert.deepStrictEqual(state.children, ["p", "figure", "p"], `urutan public article tidak sesuai: ${JSON.stringify(state)}`);
        assert.strictEqual(state.src, "https://cdn.example.com/news/middle.webp");
        assert.strictEqual(state.alt, "Foto tengah berita");
        assert.strictEqual(state.loading, "lazy");
        assert.strictEqual(state.caption, "Keterangan foto");
        assert.deepStrictEqual(state.schemaImages, ["https://cdn.example.com/news/middle.webp"]);
        assert.strictEqual(state.ogImage, "https://nexshop.cloud/api/seo/thumbnail?page=berita");
        console.log("PASS qa_news_inline_image_public_browser: inline image renders in selected content order and remains SEO-compatible");
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => {
    console.error(error.stack || error.message);
    process.exit(1);
});
