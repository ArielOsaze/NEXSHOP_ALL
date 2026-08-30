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
    console.log("SKIP: Chrome/Chromium tidak ditemukan untuk QA inline image News.");
    process.exit(0);
}

const frontend = path.join(__dirname, "..", "nexshop-frontend");
const fixture = `<!doctype html>
<html><body>
<button id="editInlineImageUploadBtn" type="button">Tambah</button>
<input id="editInlineImageFile" type="file" accept="image/jpeg,image/png,image/webp,image/gif">
<select id="editInlineImagePosition"><option value="start">Di awal konten</option></select>
<input id="editInlineImageAlt"><input id="editInlineImageCaption"><div id="editInlineImageStatus"></div>
<div id="editContentEditor" contenteditable="true"></div>
<script src="/admin/js/editorial.js"></script>
</body></html>`;

const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1:3012");
    if (url.pathname === "/fixture.html") {
        res.writeHead(200, { "Content-Type": "text/html" });
        return res.end(fixture);
    }
    const relative = decodeURIComponent(url.pathname.replace(/^\//, ""));
    const target = path.resolve(frontend, relative);
    if (!target.startsWith(frontend) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
        res.writeHead(404);
        return res.end("Not found");
    }
    res.writeHead(200, { "Content-Type": "text/javascript" });
    fs.createReadStream(target).pipe(res);
});

(async () => {
    await new Promise(resolve => server.listen(3012, "127.0.0.1", resolve));
    const browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
    try {
        const page = await browser.newPage();
        await page.setRequestInterception(true);
        page.on("request", request => {
            if (request.url().includes("/api/upload/image?type=product")) {
                return request.respond({
                    status: 200,
                    contentType: "application/json",
                    body: JSON.stringify({ url: "https://cdn.example.com/news/middle.webp" })
                });
            }
            return request.continue();
        });
        await page.goto("http://127.0.0.1:3012/fixture.html", { waitUntil: "networkidle0", timeout: 30000 });
        await page.evaluate(() => {
            const editor = document.getElementById("editContentEditor");
            editor.innerHTML = "<p>Pembuka artikel.</p><p>Bagian tengah yang menjelaskan konteks.</p><p>Penutup artikel.</p>";
            window.refreshInlineImagePositions();
            document.getElementById("editInlineImagePosition").value = "after:1";
            document.getElementById("editInlineImageAlt").value = "Ilustrasi berita gaming";
            document.getElementById("editInlineImageCaption").value = "Ilustrasi di tengah artikel";
            const input = document.getElementById("editInlineImageFile");
            const transfer = new DataTransfer();
            transfer.items.add(new File([new Uint8Array([1, 2, 3])], "middle.png", { type: "image/png" }));
            Object.defineProperty(input, "files", { configurable: true, value: transfer.files });
            input.dispatchEvent(new Event("change", { bubbles: true }));
        });
        await page.waitForFunction(() => document.querySelectorAll("#editContentEditor > figure.article-inline-image").length === 1, { timeout: 30000 });
        const state = await page.evaluate(() => ({
            blocks: [...document.querySelector("#editContentEditor").children].map(node => node.tagName.toLowerCase()),
            figureIndex: [...document.querySelector("#editContentEditor").children].findIndex(node => node.matches("figure.article-inline-image")),
            src: document.querySelector("figure.article-inline-image img")?.getAttribute("src"),
            alt: document.querySelector("figure.article-inline-image img")?.getAttribute("alt"),
            loading: document.querySelector("figure.article-inline-image img")?.getAttribute("loading"),
            caption: document.querySelector("figure.article-inline-image figcaption")?.textContent.trim(),
            status: document.getElementById("editInlineImageStatus")?.textContent.trim()
        }));
        assert.deepStrictEqual(state.blocks, ["p", "p", "figure", "p"], `urutan blok inline tidak sesuai: ${JSON.stringify(state)}`);
        assert.strictEqual(state.figureIndex, 2, `figure tidak berada setelah bagian tengah: ${JSON.stringify(state)}`);
        assert.strictEqual(state.src, "https://cdn.example.com/news/middle.webp");
        assert.strictEqual(state.alt, "Ilustrasi berita gaming");
        assert.strictEqual(state.loading, "lazy");
        assert.strictEqual(state.caption, "Ilustrasi di tengah artikel");
        assert.match(state.status, /berhasil disisipkan/i);
        console.log("PASS qa_news_inline_image_browser: uploaded image is inserted after the selected article block with accessible metadata");
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => {
    console.error(error.stack || error.message);
    process.exit(1);
});
