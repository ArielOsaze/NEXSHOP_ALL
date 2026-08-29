"use strict";

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");
const puppeteer = require(path.join(__dirname, "..", "nexshop-backend", "node_modules", "puppeteer-core"));

const root = path.resolve(__dirname, "..", "nexshop-frontend");
const executablePath = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
].find(fs.existsSync);

if (!executablePath) {
    console.log("SKIP sim77: Chrome/Chromium tidak ditemukan untuk browser docs/Hall of Fame regression.");
    process.exit(0);
}

const fixture = Array.from({ length: 10 }, (_, index) => ({
    rank: index + 1,
    name: `Fixture Reseller ${index + 1}`,
    total_spent: (index + 1) * 100000,
    badge: index === 0 ? "Top" : "",
    avatar_url: index < 3 ? `https://i.pinimg.com/fixture-${index}.jpg` : null
}));

function serve(req, res) {
    const requestUrl = new URL(req.url, "http://127.0.0.1");
    if (requestUrl.pathname === "/api/stats/leaderboard") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(fixture));
        return;
    }
    let relative = decodeURIComponent(requestUrl.pathname.replace(/^\//, ""));
    if (relative === "") relative = "index.html";
    const target = path.resolve(root, relative);
    if (!target.startsWith(root) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
        res.writeHead(404);
        res.end("Not found");
        return;
    }
    const ext = path.extname(target).toLowerCase();
    const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
    res.writeHead(200, { "Content-Type": mime[ext] || "application/octet-stream" });
    fs.createReadStream(target).pipe(res);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
    const server = http.createServer(serve);
    const apiServer = http.createServer((req, res) => {
        if (new URL(req.url, "http://127.0.0.1").pathname === "/api/stats/leaderboard") {
            res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
            res.end(JSON.stringify(fixture));
            return;
        }
        res.writeHead(404);
        res.end("Not found");
    });
    let browser;
    try {
        await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
        await new Promise((resolve) => apiServer.listen(3000, "127.0.0.1", resolve));
        browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
        const page = await browser.newPage();
        const pageErrors = [];
        page.on("pageerror", (error) => pageErrors.push(error.message));
        const baseUrl = `http://127.0.0.1:${server.address().port}`;

        await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
        await page.goto(`${baseUrl}/index.html?sim77=hof`, { waitUntil: "networkidle2", timeout: 30000 });
        await page.$eval("#leaderboardSection", (section) => section.scrollIntoView({ behavior: "instant", block: "center" }));
        await page.waitForSelector("#leaderboardContent .hof-avatar-media", { timeout: 10000 });
        const hof = await page.evaluate(() => ({
            profiles: document.querySelectorAll("#leaderboardContent .hof-avatar-media").length,
            images: document.querySelectorAll("#leaderboardContent .hof-avatar-image").length,
            fallbacks: document.querySelectorAll("#leaderboardContent .hof-avatar-fallback").length,
            lazy: [...document.querySelectorAll("#leaderboardContent .hof-avatar-image")].every((image) => image.loading === "lazy"),
            names: document.querySelector("#leaderboardContent")?.textContent.includes("Fixture Reseller 1")
        }));
        assert.deepStrictEqual(hof, { profiles: 10, images: 3, fallbacks: 10, lazy: true, names: true }, "Hall of Fame renders profiles and avatar fallbacks");

        const fallbackAfterError = await page.evaluate(() => {
            const image = document.querySelector("#leaderboardContent .hof-avatar-image");
            const parent = image.parentElement;
            image.dispatchEvent(new Event("error", { bubbles: false }));
            return {
                removedImage: !image.isConnected,
                fallbackVisible: Boolean(parent.querySelector(".hof-avatar-fallback"))
            };
        });
        assert.deepStrictEqual(fallbackAfterError, { removedImage: true, fallbackVisible: true }, "broken avatar keeps profile visible with fallback");

        await page.goto(`${baseUrl}/docs-reseller.html?sim77=docs`, { waitUntil: "networkidle2", timeout: 30000 });
        const docs = await page.evaluate(() => {
            const body = getComputedStyle(document.body);
            const heading = getComputedStyle(document.querySelector("h1"));
            const paragraph = getComputedStyle(document.querySelector(".docs-section p"));
            return {
                scoped: document.body.classList.contains("reseller-docs-page"),
                stylesheet: [...document.querySelectorAll("link[rel=stylesheet]")].some((link) => link.href.includes("docs-reseller.css")),
                background: body.backgroundColor,
                headingColor: heading.color,
                paragraphColor: paragraph.color,
                overflow: document.documentElement.scrollWidth > innerWidth + 1
            };
        });
        assert.deepStrictEqual(docs, {
            scoped: true,
            stylesheet: true,
            background: "rgb(247, 249, 252)",
            headingColor: "rgb(16, 24, 40)",
            paragraphColor: "rgb(71, 84, 103)",
            overflow: false
        }, "docs reseller theme and readable text are applied");

        for (const width of [320, 390, 768]) {
            await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
            await page.goto(`${baseUrl}/docs-reseller.html?sim77=docs-${width}`, { waitUntil: "networkidle2", timeout: 30000 });
            const mobileDocs = await page.evaluate(() => ({
                overflow: document.documentElement.scrollWidth > innerWidth + 1,
                toc: Boolean(document.querySelector(".docs-nav, .docs-mobile-toc")),
                labels: [...document.querySelectorAll(".docs-nav a")].every((link) => getComputedStyle(link).textOverflow !== "ellipsis")
            }));
            assert.deepStrictEqual(mobileDocs, { overflow: false, toc: true, labels: true }, `docs mobile ${width}px remains readable and contained`);
        }

        await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
        await page.goto(`${baseUrl}/portal-reseller.html?sim77=portal`, { waitUntil: "networkidle2", timeout: 30000 });
        const portal = await page.evaluate(() => {
            const rootStyle = getComputedStyle(document.body);
            const placeholder = document.querySelector("input") ? getComputedStyle(document.querySelector("input"), "::placeholder").color : "";
            return {
                muted: rootStyle.getPropertyValue("--portal-muted").trim(),
                faint: rootStyle.getPropertyValue("--portal-faint").trim(),
                placeholder,
                overflow: document.documentElement.scrollWidth > innerWidth + 1
            };
        });
        assert.strictEqual(portal.muted, "#475467", "portal muted text uses readable contrast token");
        assert.strictEqual(portal.faint, "#667085", "portal faint text uses readable contrast token");
        assert.strictEqual(portal.overflow, false, "portal has no desktop overflow");
        assert.deepStrictEqual(pageErrors, [], `browser page errors: ${pageErrors.join(" | ")}`);
        console.log("PASS sim77: Hall of Fame profiles/avatar fallback, docs reseller theme, portal readability, dan desktop overflow tervalidasi.");
    } finally {
        if (browser) await browser.close();
        await new Promise((resolve) => server.close(resolve));
        await new Promise((resolve) => apiServer.close(resolve));
    }
})().catch((error) => {
    console.error(`FAIL sim77: ${error.stack || error.message}`);
    process.exitCode = 1;
});
