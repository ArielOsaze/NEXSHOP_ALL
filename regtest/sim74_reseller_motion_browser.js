"use strict";

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");
const puppeteer = require(path.join(__dirname, "..", "nexshop-backend", "node_modules", "puppeteer-core"));

const root = path.resolve(__dirname, "..", "nexshop-frontend");
const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".webp": "image/webp", ".png": "image/png", ".woff2": "font/woff2" };
const executablePath = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"].find(fs.existsSync);
if (!executablePath) {
    console.log("SKIP sim74: Chrome/Chromium tidak ditemukan untuk browser motion regression.");
    process.exit(0);
}

function serveStatic(req, res) {
    const requestUrl = new URL(req.url, "http://127.0.0.1");
    let relative = decodeURIComponent(requestUrl.pathname.replace(/^\//, ""));
    if (relative === "reseller") relative = "reseller.html";
    const target = path.resolve(root, relative || "index.html");
    if (!target.startsWith(root) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
        res.writeHead(404);
        res.end("Not found");
        return;
    }
    res.writeHead(200, { "Content-Type": mime[path.extname(target).toLowerCase()] || "application/octet-stream" });
    fs.createReadStream(target).pipe(res);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
    const server = http.createServer(serveStatic);
    let browser;
    try {
        await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
        browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
        const page = await browser.newPage();
        const errors = [];
        page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
        page.on("pageerror", (error) => errors.push(error.message));
        const baseUrl = `http://127.0.0.1:${server.address().port}`;

        for (const width of [320, 390, 768, 1440]) {
            await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
            await page.goto(`${baseUrl}/reseller.html?sim74=${width}`, { waitUntil: "networkidle2", timeout: 30000 });
            await page.evaluate(() => window.scrollTo(0, 0));
            const initial = await page.evaluate(() => ({
                overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
                ready: document.body.classList.contains("rs-motion-ready"),
                heroVisible: document.querySelector(".rs-hero-visual")?.classList.contains("rs-is-visible"),
                heroAnimation: getComputedStyle(document.querySelector(".rs-portal-window")).animationName
            }));
            assert.strictEqual(initial.overflow, false, `viewport ${width}: no transient horizontal overflow`);
            assert.strictEqual(initial.ready, true, `viewport ${width}: motion system ready`);
            assert.strictEqual(initial.heroVisible, true, `viewport ${width}: hero visual revealed`);
            assert.ok(initial.heroAnimation.includes("rs-hero-window-in"), `viewport ${width}: portal window entrance animation`);

            for (let index = 0; index < 4; index += 1) {
                await page.evaluate((cardIndex) => document.querySelectorAll(".rs-feature-card")[cardIndex]?.scrollIntoView({ behavior: "instant", block: "center" }), index);
                await sleep(160);
            }
            const benefits = await page.evaluate(() => ({
                visible: [...document.querySelectorAll(".rs-feature-card")].filter((el) => el.classList.contains("rs-is-visible")).length,
                total: document.querySelectorAll(".rs-feature-card").length,
                overflow: document.documentElement.scrollWidth > window.innerWidth + 1
            }));
            assert.strictEqual(benefits.visible, benefits.total, `viewport ${width}: benefit cards reveal`);
            assert.strictEqual(benefits.overflow, false, `viewport ${width}: no overflow after reveal`);

            if (width <= 860) {
                await page.click("#resellerNavToggle");
                assert.deepStrictEqual(await page.evaluate(() => ({ open: document.body.classList.contains("rs-menu-is-open"), expanded: document.getElementById("resellerNavToggle").getAttribute("aria-expanded"), focus: document.activeElement?.tagName })), { open: true, expanded: "true", focus: "A" });
                await page.click("#resellerNavToggle");
            }

            await page.$eval("#faq-trigger-1", (element) => element.scrollIntoView({ behavior: "instant", block: "center" }));
            await page.$eval("#faq-trigger-1", (element) => element.click());
            const faqOpen = await page.$eval("#faq-panel-1", (panel) => ({ hidden: panel.hidden, open: panel.classList.contains("rs-faq-panel-open"), maxHeight: panel.style.maxHeight }));
            assert.strictEqual(faqOpen.hidden, false, `viewport ${width}: FAQ opens without losing hidden semantics`);
            assert.strictEqual(faqOpen.open, true, `viewport ${width}: FAQ open state`);
            assert.ok(faqOpen.maxHeight.endsWith("px"), `viewport ${width}: FAQ height transition initialized`);
            await page.$eval("#faq-trigger-1", (element) => element.click());
            await sleep(500);
            assert.strictEqual(await page.$eval("#faq-panel-1", (panel) => panel.hidden), true, `viewport ${width}: FAQ closes after transition`);
        }

        await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
        await page.evaluate(() => document.getElementById("api")?.scrollIntoView({ block: "center" }));
        await sleep(120);
        const apiMotion = await page.evaluate(() => ({
            visible: document.querySelector(".rs-code-card")?.classList.contains("rs-is-visible"),
            sheen: getComputedStyle(document.querySelector(".rs-code-card"), "::after").animationName
        }));
        assert.strictEqual(apiMotion.visible, true, "API code card reveals on scroll");
        assert.ok(apiMotion.sheen.includes("rs-code-sheen"), "API code card sheen runs once");

        await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
        await page.goto(`${baseUrl}/reseller.html?sim74=reduced`, { waitUntil: "networkidle2", timeout: 30000 });
        const reduced = await page.evaluate(() => ({
            overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
            hiddenRevealCount: [...document.querySelectorAll(".rs-reveal")].filter((el) => getComputedStyle(el).opacity !== "1").length,
            animatedCount: [...document.querySelectorAll(".rs-hero, .rs-hero-glow, .rs-portal-window, .rs-network-line, .rs-hero-float-top, .rs-hero-float-bottom, .rs-code-card")].filter((el) => getComputedStyle(el).animationName !== "none").length,
            tilt: getComputedStyle(document.querySelector(".rs-hero-visual")).transform
        }));
        assert.deepStrictEqual(reduced, { overflow: false, hiddenRevealCount: 0, animatedCount: 0, tilt: "none" }, "reduced-motion renders content directly and stops decoration");
        await page.click("#faq-trigger-1");
        await page.click("#faq-trigger-1");
        assert.strictEqual(await page.$eval("#faq-panel-1", (panel) => panel.hidden), true, "reduced-motion FAQ closes synchronously");
        assert.deepStrictEqual(errors, [], `browser errors: ${errors.join(" | ")}`);
        console.log("PASS sim74: reseller motion runtime, responsive overflow, menu, FAQ transition, API sheen, dan reduced-motion tervalidasi.");
    } finally {
        if (browser) await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
})().catch((error) => {
    console.error(`FAIL sim74: ${error.stack || error.message}`);
    process.exitCode = 1;
});
