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
    console.log("SKIP: Chrome/Chromium tidak ditemukan untuk QA legalitas, NexBot, dan portal.");
    process.exit(0);
}

const frontend = path.join(__dirname, "..", "nexshop-frontend");
const mime = {
    ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
    ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png"
};

function json(res, status, body) {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1:3000");
    if (url.pathname === "/api/reseller/portal/overview") {
        const auth = req.headers.authorization || "";
        if (auth !== "Bearer good-token") {
            return json(res, 401, { message: "Sesi reseller tidak valid" });
        }
        return setTimeout(() => json(res, 200, {
            user: {
                email: "mitra@nexshop.test", fullname: "Mitra QA", phone: "08123456789",
                member_code: "NX-QA", balance: 250000, reseller_status: "approved",
                reseller_tier: { name: "Mitra", code: "mitra", discount_percent: 2 }
            },
            metrics: {
                today: { count: 0, amount: 0 }, yesterday: { count: 0, amount: 0 },
                this_month: { count: 0, amount: 0 }, last_month: { count: 0, amount: 0 }, daily_chart: []
            },
            news: [], security_indicator: {}
        }), 350);
    }
    if (url.pathname === "/api/topup/catalog/operators") {
        return json(res, 200, { items: [], page: 1, total: 0, has_more: false, total_operators: 0, categories: [] });
    }
    if (url.pathname === "/api/settings/store") {
        return json(res, 200, { store_name: "NexShop", contact_whatsapp: "628123456789" });
    }
    if (url.pathname === "/api/ai/chat") {
        return setTimeout(() => json(res, 200, { reply: "Halo! Maskot NexBot sedang aktif." }), 400);
    }
    if (url.pathname.startsWith("/api/")) return json(res, 200, []);

    let relative = decodeURIComponent(url.pathname.replace(/^\//, ""));
    if (relative === "marketplace") relative = "marketplace.html";
    if (relative === "portal-reseller") relative = "portal-reseller.html";
    const target = path.resolve(frontend, relative || "index.html");
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
        const market = await browser.newPage();
        await market.setViewport({ width: 390, height: 844 });
        await market.evaluateOnNewDocument(() => localStorage.setItem("nexshop_cookie_consent", "v1.all"));
        await market.goto("http://127.0.0.1:3000/marketplace", { waitUntil: "domcontentloaded", timeout: 30000 });
        await market.waitForSelector('a[href="/legalitas"]');
        await market.$eval('a[href="/legalitas"]', (link) => link.click());
        await market.waitForSelector("#sharedLegalOverlay.active");
        const legalState = await market.evaluate(() => ({
            pathname: location.pathname,
            dialog: document.querySelector("#sharedLegalOverlay [role=dialog]")?.getAttribute("aria-modal"),
            title: document.getElementById("sharedLegalTitle")?.textContent.trim()
        }));
        if (legalState.pathname !== "/marketplace" || legalState.dialog !== "true" || legalState.title !== "Informasi Legalitas") {
            throw new Error(`modal legalitas tidak lokal/valid: ${JSON.stringify(legalState)}`);
        }
        await market.keyboard.press("Escape");
        await market.waitForFunction(() => !document.getElementById("sharedLegalOverlay")?.classList.contains("active"));
        await market.waitForSelector('.nexbot-mascot-image[src="/images/nexbot-mascot.webp"]');
        const mascotLoaded = await market.$eval(".nexbot-mascot-image", (img) => img.complete && img.naturalWidth === 640 && img.naturalHeight === 640);
        if (!mascotLoaded) throw new Error("aset maskot NexBot gagal dimuat");
        await market.waitForFunction(() => {
            const bubble = document.getElementById("nexbotSpeechBubble");
            const widget = document.getElementById("nexbotWidget");
            const floatBtn = document.getElementById("nexbotFloatBtn");
            return bubble && widget && Number.parseFloat(getComputedStyle(widget).opacity) > 0.9 &&
                !bubble.classList.contains("is-hidden") &&
                floatBtn?.classList.contains("is-bubble-greeting") &&
                getComputedStyle(floatBtn.querySelector(".nexbot-mascot-image")).animationName === "nexbot-pet-bubble-greet" &&
                document.getElementById("nexbotSpeechText")?.textContent.trim() === "Hii, NexBot di sini!";
        });
        if (process.env.QA_SCREENSHOT_PATH) {
            await market.screenshot({ path: process.env.QA_SCREENSHOT_PATH });
        }

        const floatBox = await market.$eval("#nexbotFloatBtn", (button) => {
            const rect = button.getBoundingClientRect();
            return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
        });
        await market.mouse.move(floatBox.x + floatBox.width * 0.82, floatBox.y + floatBox.height * 0.25);
        const pointerReaction = await market.$eval(".nexbot-float-btn-icon", (icon) => ({
            x: icon.style.getPropertyValue("--nexbot-look-x"),
            y: icon.style.getPropertyValue("--nexbot-look-y"),
            animation: getComputedStyle(icon.querySelector(".nexbot-mascot-image")).animationName
        }));
        if (pointerReaction.x === "0px" || pointerReaction.y === "0px" || !["nexbot-mascot-wave", "nexbot-pet-curious", "nexbot-pet-bubble-greet"].includes(pointerReaction.animation)) {
            throw new Error(`maskot tidak bereaksi terhadap pointer: ${JSON.stringify(pointerReaction)}`);
        }

        for (let index = 0; index < 5; index += 1) {
            const horizontal = index % 2 === 0 ? 0.18 : 0.82;
            await market.mouse.move(floatBox.x + floatBox.width * horizontal, floatBox.y + floatBox.height * 0.52, { steps: 3 });
        }
        await market.waitForFunction(() => document.getElementById("nexbotSpeechText")?.textContent.includes("geli"));
        const petReaction = await market.evaluate(() => ({
            mood: document.getElementById("nexbotWidget")?.dataset.petMood,
            sparkCount: document.querySelectorAll(".nexbot-pet-sparks span").length,
            text: document.getElementById("nexbotSpeechText")?.textContent.trim()
        }));
        if (petReaction.mood !== "happy" || petReaction.sparkCount < 1 || !petReaction.text.includes("geli")) {
            throw new Error(`gestur elus NexBot tidak bereaksi: ${JSON.stringify(petReaction)}`);
        }

        await market.click("#nexbotFloatBtn");
        await market.waitForSelector("#nexbotWindow:not(.hidden)");
        await market.focus("#nexbotInput");
        await market.type("#nexbotInput", "Halo NexBot");
        const listening = await market.$eval("#nexbotWindow", (windowEl) => windowEl.classList.contains("is-listening"));
        if (!listening) throw new Error("maskot tidak bereaksi ketika input aktif");
        await market.click("#nexbotSendBtn");
        await market.waitForFunction(() => document.getElementById("nexbotWindow")?.classList.contains("is-thinking"));
        await market.waitForFunction(() => !document.getElementById("nexbotWindow")?.classList.contains("is-thinking"));
        await market.waitForSelector(".nexbot-msg--bot.nexbot-msg--arriving");
        await market.close();
        console.log("PASS browser: bubble bersih dan pet NexBot melambaikan sapaan, mengikuti pointer, bereaksi saat dielus, berpikir, serta menjawab");

        const guest = await browser.newPage();
        await guest.goto("http://127.0.0.1:3000/portal-reseller", { waitUntil: "domcontentloaded", timeout: 30000 });
        await guest.waitForFunction(() => getComputedStyle(document.getElementById("sectionAuth")).display !== "none");
        const guestState = await guest.evaluate(() => ({
            auth: getComputedStyle(document.getElementById("sectionAuth")).display,
            dashboard: getComputedStyle(document.getElementById("sectionDashboard")).display
        }));
        if (guestState.auth === "none" || guestState.dashboard !== "none") throw new Error(`guest portal bocor: ${JSON.stringify(guestState)}`);
        await guest.close();

        const stale = await browser.newPage();
        await stale.evaluateOnNewDocument(() => localStorage.setItem("nexshop-reseller-token", "stale-token"));
        await stale.goto("http://127.0.0.1:3000/portal-reseller", { waitUntil: "domcontentloaded", timeout: 30000 });
        await stale.waitForFunction(() => !localStorage.getItem("nexshop-reseller-token"));
        const staleState = await stale.evaluate(() => ({
            auth: getComputedStyle(document.getElementById("sectionAuth")).display,
            dashboard: getComputedStyle(document.getElementById("sectionDashboard")).display
        }));
        if (staleState.auth === "none" || staleState.dashboard !== "none") throw new Error(`stale token portal bocor: ${JSON.stringify(staleState)}`);
        await stale.close();

        const valid = await browser.newPage();
        await valid.evaluateOnNewDocument(() => localStorage.setItem("nexshop-reseller-token", "good-token"));
        await valid.goto("http://127.0.0.1:3000/portal-reseller", { waitUntil: "domcontentloaded", timeout: 30000 });
        const beforeValidation = await valid.$eval("#sectionDashboard", (el) => getComputedStyle(el).display);
        if (beforeValidation !== "none") throw new Error("dashboard tampil sebelum overview tervalidasi");
        await valid.waitForFunction(() => getComputedStyle(document.getElementById("sectionDashboard")).display === "flex");
        await valid.close();
        console.log("PASS browser: portal guest/stale tertutup dan dashboard valid tidak berkedip sebelum verifikasi");
    } finally {
        await browser.close();
        server.close();
    }
})().catch((error) => {
    console.error("FAIL browser QA:", error.message);
    server.close();
    process.exit(1);
});
