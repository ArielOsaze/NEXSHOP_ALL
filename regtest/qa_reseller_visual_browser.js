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
    console.log("SKIP: Chrome/Chromium tidak ditemukan untuk visual QA reseller.");
    process.exit(0);
}

const frontend = path.join(__dirname, "..", "nexshop-frontend");
const mime = {
    ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
    ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png",
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".ico": "image/x-icon",
    ".json": "application/json"
};

const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1:3000");
    if (url.pathname.startsWith("/api/")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ items: [], data: [], tiers: [], articles: [] }));
    }
    let relative = decodeURIComponent(url.pathname.replace(/^\//, ""));
    if (relative === "reseller") relative = "reseller.html";
    const target = path.resolve(frontend, relative || "index.html");
    if (!target.startsWith(frontend) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
        res.writeHead(404);
        return res.end("Not found");
    }
    res.writeHead(200, { "Content-Type": mime[path.extname(target)] || "application/octet-stream" });
    fs.createReadStream(target).pipe(res);
});

(async () => {
    await new Promise((resolve) => server.listen(3000, "127.0.0.1", resolve));
    const browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
    const results = [];
    try {
        for (const width of [320, 360, 390, 768, 1024, 1440]) {
            const page = await browser.newPage();
            await page.setViewport({ width, height: width <= 640 ? 844 : 900, deviceScaleFactor: 1 });
            await page.goto("http://127.0.0.1:3000/reseller", { waitUntil: "networkidle0", timeout: 30000 });
            await page.waitForSelector(".rs-hero h1");
            const state = await page.evaluate(() => {
                const hero = document.querySelector(".rs-hero");
                const visual = document.querySelector(".rs-hero-visual");
                const floatTop = document.querySelector(".rs-hero-float-top");
                const floatBottom = document.querySelector(".rs-hero-float-bottom");
                const h1 = document.querySelector(".rs-hero h1");
                const lead = document.querySelector(".rs-hero-lead");
                const rect = (element) => {
                    const box = element?.getBoundingClientRect();
                    return box ? { left: Math.round(box.left), right: Math.round(box.right), width: Math.round(box.width) } : null;
                };
                return {
                    width: innerWidth,
                    layoutWidth: Math.round(document.body.getBoundingClientRect().width),
                    documentWidth: document.documentElement.scrollWidth,
                    overflow: document.documentElement.scrollWidth > document.body.getBoundingClientRect().width + 1,
                    hero: rect(hero),
                    body: rect(document.body),
                    main: rect(document.querySelector("main")),
                    bodyComputedWidth: getComputedStyle(document.body).width,
                    mainComputedWidth: getComputedStyle(document.querySelector("main")).width,
                    visual: rect(visual),
                    floatTop: rect(floatTop),
                    floatBottom: rect(floatBottom),
                    h1Font: getComputedStyle(h1).fontFamily,
                    bodyFont: getComputedStyle(document.body).fontFamily,
                    leadFont: getComputedStyle(lead).fontFamily,
                    h1LineHeight: getComputedStyle(h1).lineHeight,
                    leadLineHeight: getComputedStyle(lead).lineHeight,
                    boltCount: document.querySelectorAll(".fa-bolt, .fa-lightning").length
                };
            });
            if (state.overflow) throw new Error(`horizontal overflow at ${width}px: ${JSON.stringify(state)}`);
            if (!state.hero || state.hero.left !== 0 || state.hero.width !== state.layoutWidth) {
                throw new Error(`hero is not full-bleed at ${width}px: ${JSON.stringify(state)}`);
            }
            for (const [name, box] of [["top", state.floatTop], ["bottom", state.floatBottom]]) {
                if (!box || box.left < 0 || box.right > state.layoutWidth) {
                    throw new Error(`${name} float is cropped at ${width}px: ${JSON.stringify(box)}`);
                }
            }
            if (state.boltCount !== 0) throw new Error(`lightning icon remains at ${width}px`);
            if (!/Sora/i.test(state.h1Font)) throw new Error(`unexpected reseller display font at ${width}px: ${state.h1Font}`);
            if (!/Plus Jakarta Sans/i.test(state.bodyFont) || !/Plus Jakarta Sans/i.test(state.leadFont)) {
                throw new Error(`unexpected reseller body font at ${width}px: ${JSON.stringify({ body: state.bodyFont, lead: state.leadFont })}`);
            }
            results.push({ width, overflow: state.overflow, heroWidth: state.hero.width, floatBounds: [state.floatTop, state.floatBottom], h1Font: state.h1Font, bodyFont: state.bodyFont, leadFont: state.leadFont, h1LineHeight: state.h1LineHeight, leadLineHeight: state.leadLineHeight });
            if (width === 390 || width === 1440) {
                await page.screenshot({ path: path.join(__dirname, `qa_reseller_${width}.png`), fullPage: false });
            }
            await page.close();
        }
        console.log(`PASS browser reseller visual QA: ${JSON.stringify(results)}`);
    } finally {
        await browser.close();
        server.close();
    }
})().catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
});
