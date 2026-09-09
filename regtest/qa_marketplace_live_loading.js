"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const puppeteer = require(path.join(__dirname, "..", "nexshop-backend", "node_modules", "puppeteer-core"));

const chrome = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe"
].find(fs.existsSync);

(async () => {
    assert(chrome, "Chrome/Edge executable tidak ditemukan");
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox"] });
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
        const pageErrors = [];
        const consoleErrors = [];
        const catalogResponses = [];
        page.on("pageerror", (error) => pageErrors.push(error.message));
        page.on("console", (message) => {
            if (message.type() === "error") consoleErrors.push(message.text());
        });
        page.on("response", (response) => {
            if (response.url().includes("/api/topup/catalog/operators")) catalogResponses.push(response.status());
        });

        await page.goto("https://nexshop.cloud/marketplace?qa=loading-loop", { waitUntil: "networkidle0", timeout: 30000 });
        await page.waitForFunction(() => {
            const loader = document.getElementById("appLoader");
            const cards = document.querySelectorAll("#marketGrid .market-card:not(.is-skeleton)");
            return loader && !loader.classList.contains("is-visible") && cards.length > 0;
        }, { timeout: 15000 });

        const state = await page.evaluate(() => ({
            loaderVisible: document.getElementById("appLoader")?.classList.contains("is-visible"),
            cardCount: document.querySelectorAll("#marketGrid .market-card:not(.is-skeleton)").length,
            gridBusy: document.getElementById("marketGrid")?.getAttribute("aria-busy"),
            emptyText: document.querySelector("#marketGrid .mkt-empty")?.textContent?.trim() || ""
        }));

        assert.strictEqual(state.loaderVisible, false, "loader marketplace harus hilang");
        assert(state.cardCount > 0, "operator marketplace harus tampil");
        assert(catalogResponses.includes(200), `request katalog harus 200, dapat ${catalogResponses.join(",")}`);
        assert(!pageErrors.some((message) => /Content Security Policy|loadCatalog|API_BASE/i.test(message)), `page error marketplace: ${pageErrors.join(" | ")}`);
        assert(!consoleErrors.some((message) => /Content Security Policy|loadCatalog|catalog/i.test(message)), `console error marketplace: ${consoleErrors.join(" | ")}`);
        console.log(`PASS qa_marketplace_live_loading: loader hidden, cards=${state.cardCount}, catalog_status=${catalogResponses.join(",")}`);
    } finally {
        await browser.close();
    }
})().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
});
