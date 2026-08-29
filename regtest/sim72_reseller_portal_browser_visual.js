"use strict";

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const puppeteer = require(path.join(__dirname, "..", "nexshop-backend", "node_modules", "puppeteer-core"));

const frontend = path.join(__dirname, "..", "nexshop-frontend");
const mime = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json" };
const chromeCandidates = process.platform === "win32" ? [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
] : ["/usr/bin/google-chrome-stable", "/usr/bin/google-chrome", "/usr/bin/chromium"];
const executablePath = chromeCandidates.find(fs.existsSync);
if (!executablePath) {
    console.log("SKIP sim72: Chrome/Chromium tidak ditemukan untuk responsive visual browser test.");
    process.exit(0);
}

function json(res, body, status = 200) {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/api/reseller/portal/overview") {
        if (req.headers.authorization !== "Bearer visual-fixture-token") return json(res, { message: "Sesi tidak valid" }, 401);
        return json(res, {
            user: { email: "visual-fixture@example.test", fullname: "Mitra Visual QA", phone: "", member_code: "NX-VISUAL", balance: 250000, reseller_status: "approved", reseller_tier: { name: "Silver", code: "silver", discount_percent: 2 } },
            metrics: { today: { count: 3, amount: 125000 }, yesterday: { count: 2, amount: 80000 }, this_month: { count: 18, amount: 750000 }, last_month: { count: 12, amount: 500000 }, daily_chart: [] },
            news: [], security_indicator: { api_key_configured: true, webhook_configured: false }
        });
    }
    if (url.pathname.startsWith("/api/")) return json(res, []);
    let relative = decodeURIComponent(url.pathname.replace(/^\//, ""));
    if (relative === "portal-reseller") relative = "portal-reseller.html";
    const target = path.resolve(frontend, relative || "index.html");
    if (!target.startsWith(frontend) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
        res.writeHead(404); return res.end("Not found");
    }
    res.writeHead(200, { "Content-Type": mime[path.extname(target)] || "application/octet-stream" });
    fs.createReadStream(target).pipe(res);
});

function fail(message, state) { throw new Error(`${message}: ${JSON.stringify(state)}`); }

(async () => {
    let browser;
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
        browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
        for (const viewport of [
            { width: 1440, height: 900, name: "desktop" },
            { width: 1024, height: 900, name: "laptop" },
            { width: 768, height: 900, name: "tablet" },
            { width: 390, height: 844, name: "mobile390" },
            { width: 360, height: 800, name: "mobile360" }
        ]) {
            const page = await browser.newPage();
            await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1 });
            await page.evaluateOnNewDocument(() => localStorage.setItem("nexshop-reseller-token", "visual-fixture-token"));
            const consoleErrors = [];
            const failedRequests = [];
            page.on("pageerror", (error) => consoleErrors.push(error.message));
            page.on("requestfailed", (request) => failedRequests.push(request.url()));
            await page.goto(`${baseUrl}/portal-reseller`, { waitUntil: "networkidle0", timeout: 30000 });
            await page.waitForFunction(() => getComputedStyle(document.getElementById("sectionDashboard")).display === "flex");
            const state = await page.evaluate(() => {
                const dashboard = document.getElementById("sectionDashboard");
                const sidebar = document.getElementById("tvSidebar");
                const main = document.querySelector(".tv-console-main");
                const body = document.body;
                return {
                    dashboard: getComputedStyle(dashboard).display,
                    pageClass: body.classList.contains("rs-portal-page"),
                    pageTitle: document.getElementById("tvPageTitle")?.textContent.trim(),
                    cssLoaded: [...document.styleSheets].some((sheet) => sheet.href?.includes("portal-reseller.css")),
                    uiLoaded: [...document.scripts].some((script) => script.src.includes("portal-reseller-ui.js")),
                    bodyBg: getComputedStyle(body).backgroundColor,
                    mainBg: main ? getComputedStyle(main).backgroundColor : "",
                    sidebarBg: sidebar ? getComputedStyle(sidebar).backgroundColor : "",
                    sidebarPosition: sidebar ? getComputedStyle(sidebar).position : "",
                    menuDisplay: getComputedStyle(document.querySelector(".tv-mobile-menu-button")).display,
                    overflow: Math.max(document.documentElement.scrollWidth, body.scrollWidth) - document.documentElement.clientWidth
                };
            });
            if (!state.pageClass || !state.cssLoaded || !state.uiLoaded || state.dashboard !== "flex") fail(`shell ${viewport.name} tidak siap`, state);
            if (state.bodyBg !== "rgb(247, 249, 252)" || state.mainBg !== "rgba(0, 0, 0, 0)" || state.sidebarBg !== "rgb(255, 255, 255)") fail(`palet ${viewport.name} tidak sesuai`, state);
            if (state.overflow > 0) fail(`horizontal overflow ${viewport.name}`, state);
            const mobile = viewport.width <= 992;
            if (mobile && (state.sidebarPosition !== "fixed" || state.menuDisplay === "none")) fail(`drawer mobile ${viewport.name} tidak aktif`, state);
            if (!mobile && (state.sidebarPosition !== "sticky" || state.menuDisplay !== "none")) fail(`shell desktop ${viewport.name} tidak aktif`, state);
            if (mobile) {
                await page.click(".tv-mobile-menu-button");
                await page.waitForFunction(() => {
                    const rect = document.querySelector("#tvSidebar").getBoundingClientRect();
                    return rect.left >= -1;
                });
                const drawer = await page.evaluate(() => ({ scrim: getComputedStyle(document.querySelector(".tv-sidebar-scrim")).display, expanded: document.querySelector(".tv-mobile-menu-button").getAttribute("aria-expanded"), focus: document.activeElement?.className }));
                if (drawer.scrim !== "block" || drawer.expanded !== "true" || !String(drawer.focus).includes("tv-nav-link")) fail(`drawer open ${viewport.name}`, drawer);
                const moreBox = await page.$eval(".tv-nav-more", (el) => ({ rect: el.getBoundingClientRect().toJSON(), display: getComputedStyle(el).display, pointer: getComputedStyle(el).pointerEvents, sidebarClass: el.closest(".tv-sidebar")?.className, shellClass: document.getElementById("sectionDashboard").className }));
                if (moreBox.rect.left < -1 || moreBox.display !== "flex") fail(`menu Lainnya tidak terjangkau ${viewport.name}`, moreBox);
                await page.$eval(".tv-nav-more", (el) => el.click());
                const more = await page.evaluate(() => ({ expanded: document.querySelector(".tv-nav-more").getAttribute("aria-expanded"), display: getComputedStyle(document.getElementById("tvNavSecondary")).display, count: document.querySelectorAll("#tvNavSecondary .tv-nav-link").length }));
                if (more.expanded !== "true" || more.display !== "grid" || more.count !== 3) fail(`menu Lainnya ${viewport.name}`, more);
                await page.keyboard.press("Escape");
                await page.waitForFunction(() => !document.getElementById("sectionDashboard").classList.contains("portal-drawer-open"));
                const closed = await page.evaluate(() => ({ expanded: document.querySelector(".tv-mobile-menu-button").getAttribute("aria-expanded"), focus: document.activeElement?.className }));
                if (closed.expanded !== "false" || !String(closed.focus).includes("tv-mobile-menu-button")) fail(`drawer close ${viewport.name}`, closed);
            }
            if (mobile) {
                await page.$eval('[data-view="view-transactions"]', (el) => el.click());
            } else {
                await page.click('[data-view="view-transactions"]');
            }
            await page.waitForFunction(() => document.querySelector('[data-view="view-transactions"]').classList.contains("active"));
            const title = await page.$eval("#tvPageTitle", (el) => el.textContent.trim());
            if (title !== "Transaksi") fail(`page chrome ${viewport.name}`, { title });
            if (consoleErrors.length || failedRequests.length) fail(`runtime ${viewport.name}`, { consoleErrors, failedRequests });
            await page.close();
            console.log(`PASS sim72 ${viewport.name}: shell, drawer/navigation, overflow, and runtime clean`);
        }

        const reduced = await browser.newPage();
        await reduced.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
        await reduced.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
        await reduced.evaluateOnNewDocument(() => localStorage.setItem("nexshop-reseller-token", "visual-fixture-token"));
        await reduced.goto(`${baseUrl}/portal-reseller`, { waitUntil: "networkidle0", timeout: 30000 });
        await reduced.waitForFunction(() => getComputedStyle(document.getElementById("sectionDashboard")).display === "flex");
        const motion = await reduced.evaluate(() => {
            const view = document.querySelector(".tv-console-view.active");
            const card = document.querySelector(".tv-card-widget");
            return { viewDuration: getComputedStyle(view).animationDuration, cardDuration: getComputedStyle(card).animationDuration };
        });
        if (Number.parseFloat(motion.viewDuration) > 0.0001 || Number.parseFloat(motion.cardDuration) > 0.0001) fail("reduced motion tidak menyederhanakan animasi", motion);
        console.log("PASS sim72 reduced-motion: transition duration disederhanakan tanpa menghapus informasi");
        await reduced.close();
    } finally {
        if (browser) await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
})().catch((error) => {
    console.error(`FAIL sim72: ${error.message}`);
    process.exit(1);
});
