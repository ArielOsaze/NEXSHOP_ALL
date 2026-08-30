"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const https = require("https");
const puppeteer = require(path.join(__dirname, "..", "nexshop-backend", "node_modules", "puppeteer-core"));

const chromeCandidates = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe"
];
const executablePath = chromeCandidates.find(fs.existsSync);
if (!executablePath) {
    console.log("SKIP qa_news_all_articles_browser: Chrome/Chromium tidak ditemukan.");
    process.exit(0);
}

function getJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, response => {
            let body = "";
            response.setEncoding("utf8");
            response.on("data", chunk => body += chunk);
            response.on("end", () => {
                if (response.statusCode < 200 || response.statusCode >= 300) {
                    return reject(new Error(`HTTP ${response.statusCode} from ${url}`));
                }
                try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
            });
        }).on("error", reject);
    });
}

(async () => {
    const json = await getJson("https://nexshop.cloud/api/news/articles?limit=100");
    const articles = Array.isArray(json.data) ? json.data : (Array.isArray(json.articles) ? json.articles : []);
    assert(articles.length > 0, "Production News API returned no articles for smoke test");
    const browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
    const failures = [];
    try {
        for (const article of articles) {
            const page = await browser.newPage();
            const errors = [];
            page.on("pageerror", error => errors.push(error.message));
            try {
                await page.goto(`https://nexshop.cloud/berita/${encodeURIComponent(article.slug)}?all-news-qa=1`, { waitUntil: "networkidle0", timeout: 60000 });
                await new Promise(resolve => setTimeout(resolve, 500));
                const state = await page.evaluate(() => {
                    const body = document.getElementById("articleBodyContent");
                    return {
                        articleCount: document.querySelectorAll("#articleMain article").length,
                        bodyText: body?.innerText.trim() || "",
                        loading: !!document.getElementById("loadingState"),
                        errorState: /Gagal Memuat|Artikel Tidak Ditemukan/.test(document.getElementById("articleMain")?.innerText || "")
                    };
                });
                if (errors.length || state.articleCount !== 1 || !state.bodyText || state.loading || state.errorState) {
                    failures.push({ slug: article.slug, errors, state });
                }
            } finally {
                await page.close();
            }
        }
    } finally {
        await browser.close();
    }
    assert.deepStrictEqual(failures, [], `News blank-page failures: ${JSON.stringify(failures)}`);
    console.log(`PASS qa_news_all_articles_browser: ${articles.length} production News articles render body content without runtime errors`);
})().catch(error => {
    console.error(error.stack || error.message);
    process.exit(1);
});
