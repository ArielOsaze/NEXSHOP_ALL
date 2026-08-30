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
    console.log("SKIP: Chrome/Chromium tidak ditemukan untuk visual QA frame dan tier.");
    process.exit(0);
}

const frontend = path.join(__dirname, "..", "nexshop-frontend");
const mime = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".webp": "image/webp" };
const leaderboard = [
    { name: "A***", total_spent: 1200000, badge: "VIP", avatar_url: "/images/nexshop-logo.webp" },
    { name: "B***", total_spent: 784250, badge: "VIP", avatar_url: "/images/nexshop-logo.webp" },
    { name: "C***", total_spent: 500000, badge: "VIP", avatar_url: "/images/nexshop-logo.webp" }
];

const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1:3010");
    if (url.pathname === "/api/stats/leaderboard") {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify(leaderboard));
    }
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
    await new Promise((resolve) => server.listen(3010, "127.0.0.1", resolve));
    const browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
    try {
        const home = await browser.newPage();
        await home.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
        await home.goto("http://127.0.0.1:3010/", { waitUntil: "networkidle0", timeout: 30000 });
        await home.evaluate((rows) => renderLeaderboard(rows), leaderboard);
        await home.waitForSelector(".hof-podium-card--2");
        const hof = await home.evaluate(() => {
            const avatar = document.querySelector(".hof-avatar--2");
            const card = document.querySelector(".hof-podium-card--2");
            const avatarStyle = getComputedStyle(avatar);
            const cardStyle = getComputedStyle(card);
            return {
                avatarFrame: avatar.classList.contains("hof-avatar--2") && avatarStyle.padding !== "0px" && avatarStyle.backgroundImage.includes("gradient"),
                avatarBorder: avatarStyle.borderTopColor,
                avatarShadow: avatarStyle.boxShadow,
                cardTopBorder: cardStyle.borderTopColor,
                cardBackground: cardStyle.backgroundImage,
                hasProfileMedia: Boolean(avatar.querySelector(".hof-avatar-media"))
            };
        });
        if (!hof.avatarFrame || !hof.hasProfileMedia) throw new Error(`rank-2 avatar frame hilang/tidak terlihat: ${JSON.stringify(hof)}`);
        if (/37,\s*99,\s*235|29,\s*78,\s*216/.test(`${hof.avatarBorder} ${hof.avatarShadow} ${hof.cardTopBorder} ${hof.cardBackground}`)) throw new Error(`rank-2 masih memakai warna blue: ${JSON.stringify(hof)}`);
        await home.screenshot({ path: path.join(__dirname, "qa_hof_titanium_1440.png"), fullPage: true });

        const reseller = await browser.newPage();
        await reseller.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
        await reseller.goto("http://127.0.0.1:3010/reseller", { waitUntil: "networkidle0", timeout: 30000 });
        const tiersState = await reseller.evaluate(() => [...document.querySelectorAll(".rs-tier-card")].map((card) => {
            const style = getComputedStyle(card);
            return { code: [...card.classList].find((name) => name.startsWith("rs-tier-card-")), top: style.borderTopColor, background: style.backgroundImage, text: card.textContent };
        }));
        if (tiersState.length !== 3) throw new Error(`jumlah card tier tidak sesuai: ${JSON.stringify(tiersState)}`);
        const silver = tiersState.find((tier) => tier.code === "rs-tier-card-silver");
        const gold = tiersState.find((tier) => tier.code === "rs-tier-card-gold");
        const platinum = tiersState.find((tier) => tier.code === "rs-tier-card-platinum");
        if (!silver || !gold || !platinum || silver.top === platinum.top || silver.background === platinum.background || !/tanpa minimum transaksi bulanan/i.test(silver.text)) {
            throw new Error(`palette Silver/Gold/Platinum atau requirement Silver tidak sesuai: ${JSON.stringify(tiersState)}`);
        }
        await reseller.screenshot({ path: path.join(__dirname, "qa_reseller_tier_palette_1440.png"), fullPage: true });
        await reseller.$eval("#tiers", (element) => element.scrollIntoView({ block: "center", behavior: "instant" }));
        await new Promise((resolve) => setTimeout(resolve, 250));
        await reseller.screenshot({ path: path.join(__dirname, "qa_reseller_tier_palette_viewport_1440.png"), fullPage: false });
        console.log("PASS qa_hof_tier_palette_browser: rank-2 titanium avatar/card frame and distinct Silver/Gold/Platinum landing palettes render");
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
})().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
});
