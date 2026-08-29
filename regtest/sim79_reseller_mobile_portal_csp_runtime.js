"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const puppeteer = require(path.join(__dirname, "..", "nexshop-backend", "node_modules", "puppeteer-core"));

const root = path.join(__dirname, "..");
const frontend = path.join(root, "nexshop-frontend");
const nginx = fs.readFileSync(path.join(root, "nginx-nexshop.conf"), "utf8");
const portalHtml = fs.readFileSync(path.join(frontend, "portal-reseller.html"), "utf8");
const csp = (nginx.match(/add_header Content-Security-Policy "([^"]+)" always;/) || [])[1];
const chrome = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe"
].find(fs.existsSync);

function inlineHashes(html, tag) {
    const pattern = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}>`, "gi");
    return [...html.matchAll(pattern)]
        .filter((m) => !/\bsrc\s*=|\bhref\s*=/i.test(m[1]) && !/application\/ld\+json/i.test(m[1]) && m[2].trim())
        .map((m) => `'sha256-${crypto.createHash("sha256").update(m[2].replace(/\r\n/g, "\n"), "utf8").digest("base64")}'`);
}

function serve() {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            const pathname = new URL(req.url, "http://localhost").pathname;
            const clean = pathname === "/portal-reseller" ? "/portal-reseller.html" : pathname === "/reseller" ? "/reseller.html" : pathname;
            const file = path.resolve(frontend, `.${clean}`);
            if (!file.startsWith(frontend) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
                res.writeHead(404); return res.end("not found");
            }
            const ext = path.extname(file);
            const contentType = ext === ".html" ? "text/html" : ext === ".css" ? "text/css" : ext === ".js" ? "application/javascript" : "application/octet-stream";
            res.writeHead(200, { "content-type": contentType, "content-security-policy": csp });
            res.end(fs.readFileSync(file));
        });
        server.listen(0, "127.0.0.1", () => resolve(server));
    });
}

(async () => {
    assert(csp, "CSP nginx tidak ditemukan");
    assert(chrome, "Chrome/Edge executable tidak ditemukan");
    const allHashes = [...inlineHashes(portalHtml, "script"), ...inlineHashes(portalHtml, "style")];
    assert(allHashes.length > 0, "portal harus memiliki hash CSP yang diaudit");
    assert(allHashes.every((hash) => csp.includes(hash)), "RED: CSP belum mencakup inline script/style portal terbaru");

    const server = await serve();
    const port = server.address().port;
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox"] });
    try {
        const page = await browser.newPage();
        const errors = [];
        page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
        page.on("pageerror", (error) => errors.push(error.message));
        await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
        await page.goto(`http://127.0.0.1:${port}/portal-reseller`, { waitUntil: "networkidle0" });
        await page.waitForFunction(() => getComputedStyle(document.querySelector("#sectionAuth")).display !== "none", { timeout: 5000 });
        const portalState = await page.evaluate(() => ({
            authDisplay: getComputedStyle(document.querySelector("#sectionAuth")).display,
            authHeight: document.querySelector("#sectionAuth").getBoundingClientRect().height,
            dashboardDisplay: getComputedStyle(document.querySelector("#sectionDashboard")).display,
            loginPaneHidden: document.querySelector("#authPaneLogin").hidden
        }));
        assert(portalState.authHeight > 100 && portalState.dashboardDisplay === "none" && portalState.loginPaneHidden === false, "Portal guest harus langsung merender layar login, bukan blank dashboard");
        assert(!errors.some((error) => /Content Security Policy|Executing inline script|Applying inline style/i.test(error)), `CSP runtime memblokir Portal: ${errors.join(" | ")}`);

        await page.goto(`http://127.0.0.1:${port}/reseller`, { waitUntil: "networkidle0" });
        await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
        const hits = await page.evaluate(async () => {
            const targets = [...document.querySelectorAll("#resellerNavToggle, .rs-button, .rs-faq-trigger")]
                .filter((target) => {
                    const style = getComputedStyle(target);
                    const rect = target.getBoundingClientRect();
                    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
                });
            const data = [];
            for (const target of targets) {
                const initial = target.getBoundingClientRect();
                window.scrollTo({ top: Math.max(0, window.scrollY + initial.top - (innerHeight - initial.height) / 2), behavior: "instant" });
                await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                const rect = target.getBoundingClientRect();
                const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
                data.push({ target: target.id || target.textContent.trim().slice(0, 48), width: rect.width, height: rect.height, inViewport: rect.top >= 0 && rect.bottom <= innerHeight, hit: Boolean(hit && hit.closest("#resellerNavToggle, .rs-button, .rs-faq-trigger") === target) });
            }
            return data;
        });
        assert(hits.length === 9, `jumlah target mobile visible tidak sesuai: ${JSON.stringify(hits)}`);
        assert(hits.every((entry) => entry.width >= 44 && entry.height >= 44 && entry.inViewport && entry.hit), `Ada target mobile reseller tertutup/terlalu kecil: ${JSON.stringify(hits.filter((entry) => !(entry.width >= 44 && entry.height >= 44 && entry.inViewport && entry.hit)))}`);
        await page.click("#resellerNavToggle");
        assert(await page.$eval("#resellerNavToggle", (el) => el.getAttribute("aria-expanded") === "true"), "menu mobile reseller harus membuka saat ditap");
        const navActionHits = await page.evaluate(() => [...document.querySelectorAll("#resellerNavMenu .rs-button")].map((target) => {
            const rect = target.getBoundingClientRect();
            const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
            return { width: rect.width, height: rect.height, hit: Boolean(hit && hit.closest(".rs-button") === target) };
        }));
        assert(navActionHits.length === 2 && navActionHits.every((entry) => entry.width >= 44 && entry.height >= 44 && entry.hit), `CTA menu reseller tidak dapat ditap: ${JSON.stringify(navActionHits)}`);
        console.log("PASS sim79: Portal CSP runtime dan semua target tap reseller mobile aman");
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
