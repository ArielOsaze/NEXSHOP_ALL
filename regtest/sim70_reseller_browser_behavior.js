"use strict";

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");
const puppeteer = require(path.join(__dirname, "..", "nexshop-backend", "node_modules", "puppeteer-core"));

const root = path.resolve(__dirname, "..");
const frontend = path.join(root, "nexshop-frontend");
const mime = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json",
    ".webp": "image/webp",
    ".png": "image/png",
    ".woff2": "font/woff2"
};

const chromeCandidates = process.platform === "win32" ? [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
] : ["/usr/bin/google-chrome-stable", "/usr/bin/google-chrome", "/usr/bin/chromium"];
const executablePath = chromeCandidates.find(fs.existsSync);

if (!executablePath) {
    console.log("SKIP sim70: Chrome/Chromium tidak ditemukan untuk browser regression.");
    process.exit(0);
}

function serveStatic(req, res) {
    const requestUrl = new URL(req.url, "http://127.0.0.1");
    if (requestUrl.pathname.startsWith("/api/")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("[]");
        return;
    }

    let relative = decodeURIComponent(requestUrl.pathname.replace(/^\//, ""));
    if (relative === "reseller") relative = "reseller.html";
    const target = path.resolve(frontend, relative || "index.html");
    if (!target.startsWith(frontend) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
        res.writeHead(404);
        res.end("Not found");
        return;
    }
    res.writeHead(200, {
        "Content-Type": mime[path.extname(target).toLowerCase()] || "application/octet-stream"
    });
    fs.createReadStream(target).pipe(res);
}

(async () => {
    const server = http.createServer(serveStatic);
    let browser;
    try {
        await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
        const { port } = server.address();
        const baseUrl = `http://127.0.0.1:${port}`;
        browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
        const page = await browser.newPage();
        const consoleErrors = [];
        const pageErrors = [];
        const requestFailures = [];
        const badResponses = [];
        page.on("console", (message) => {
            if (message.type() === "error") consoleErrors.push(message.text());
        });
        page.on("pageerror", (error) => pageErrors.push(error.message));
        page.on("requestfailed", (request) => requestFailures.push(`${request.url()} :: ${request.failure()?.errorText || "failed"}`));
        page.on("response", (response) => {
            const url = response.url();
            if (response.status() >= 400 && !url.endsWith("/favicon.ico")) {
                badResponses.push(`${response.status()} ${url}`);
            }
        });

        const viewports = [1440, 1024, 768, 390, 360];
        for (const width of viewports) {
            await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
            await page.goto(`${baseUrl}/reseller.html?sim70=${width}`, { waitUntil: "networkidle2", timeout: 30000 });
            await page.evaluate(() => window.scrollTo(0, 0));
            const baseline = await page.evaluate(() => {
                const navToggle = document.getElementById("resellerNavToggle");
                const codePreview = document.querySelector(".rs-code-card pre");
                const logo = document.querySelector('img[src*="nexshop-logo"]');
                return {
                    width: window.innerWidth,
                    h1Count: document.querySelectorAll("h1").length,
                    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
                    navToggleDisplay: getComputedStyle(navToggle).display,
                    codeOverflow: getComputedStyle(codePreview).overflowX,
                    logoLoaded: Boolean(logo && logo.complete && logo.naturalWidth > 0),
                    ctas: [...document.querySelectorAll("a.rs-button")].map((link) => link.getAttribute("href"))
                };
            });
            assert.strictEqual(baseline.width, width);
            assert.strictEqual(baseline.h1Count, 1, `viewport ${width}: exactly one h1`);
            assert.strictEqual(baseline.overflow, false, `viewport ${width}: no horizontal overflow`);
            assert.strictEqual(baseline.logoLoaded, true, `viewport ${width}: local logo loaded`);
            assert.strictEqual(baseline.codeOverflow, "auto", `viewport ${width}: code preview scrolls internally`);
            assert.ok(baseline.ctas.includes("/portal-reseller?mode=register"));
            assert.ok(baseline.ctas.includes("/portal-reseller?mode=login"));
            assert.ok(baseline.ctas.includes("/docs-reseller"));

            if (width <= 860) {
                assert.notStrictEqual(baseline.navToggleDisplay, "none", `viewport ${width}: mobile menu visible`);
                await page.click("#resellerNavToggle");
                const menuState = await page.evaluate(() => ({
                    open: document.body.classList.contains("rs-menu-is-open"),
                    expanded: document.getElementById("resellerNavToggle").getAttribute("aria-expanded"),
                    panelDisplay: getComputedStyle(document.getElementById("resellerNavMenu")).display
                }));
                assert.deepStrictEqual(menuState, { open: true, expanded: "true", panelDisplay: "flex" });
                await page.click("#resellerNavToggle");
                assert.strictEqual(await page.$eval("#resellerNavToggle", (el) => el.getAttribute("aria-expanded")), "false");
            } else {
                assert.strictEqual(baseline.navToggleDisplay, "none", `viewport ${width}: desktop menu toggle hidden`);
            }

            await page.$eval("#faq-trigger-1", (element) => {
                element.scrollIntoView({ block: "center", inline: "nearest" });
                element.click();
            });
            const faqOpen = await page.$eval("#faq-panel-1", (panel) => ({ hidden: panel.hidden, text: panel.textContent.trim() }));
            assert.strictEqual(faqOpen.hidden, false, `viewport ${width}: FAQ opens`);
            assert.ok(faqOpen.text.length > 20, `viewport ${width}: FAQ answer has content`);
            assert.strictEqual(await page.$eval("#faq-trigger-1", (el) => el.getAttribute("aria-expanded")), "true");
            await page.$eval("#faq-trigger-1", (element) => element.click());
            await new Promise((resolve) => setTimeout(resolve, 500));
            assert.strictEqual(await page.$eval("#faq-panel-1", (el) => el.hidden), true, `viewport ${width}: FAQ closes`);
        }

        assert.deepStrictEqual(consoleErrors, [], `browser console errors: ${consoleErrors.join(" | ")}`);
        assert.deepStrictEqual(pageErrors, [], `page errors: ${pageErrors.join(" | ")}`);
        assert.deepStrictEqual(requestFailures, [], `failed requests: ${requestFailures.join(" | ")}`);
        assert.deepStrictEqual(badResponses, [], `bad responses: ${badResponses.join(" | ")}`);
        console.log("PASS sim70: reseller browser behavior, responsive widths, CTA, FAQ, menu, image, overflow, dan request checks.");
    } finally {
        if (browser) await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
})().catch((error) => {
    console.error(`FAIL sim70: ${error.stack || error.message}`);
    process.exitCode = 1;
});
