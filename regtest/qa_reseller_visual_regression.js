"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const root = path.join(__dirname, "..");
const puppeteer = require(path.join(root, "nexshop-backend", "node_modules", "puppeteer-core"));

const frontend = path.join(root, "nexshop-frontend");
const mime = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".webp": "image/webp", ".ico": "image/x-icon", ".json": "application/json" };
const chromeCandidates = process.platform === "win32"
    ? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"]
    : ["/usr/bin/google-chrome-stable", "/usr/bin/google-chrome", "/usr/bin/chromium"];
const executablePath = chromeCandidates.find(fs.existsSync);
if (!executablePath) { console.log("SKIP: Chrome/Chromium tidak ditemukan"); process.exit(0); }

const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1:3011");
    let relative = decodeURIComponent(url.pathname.replace(/^\//, ""));
    if (relative === "reseller") relative = "reseller.html";
    const target = path.resolve(frontend, relative || "index.html");
    if (!target.startsWith(frontend) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
        res.writeHead(404); return res.end("Not found");
    }
    res.writeHead(200, { "Content-Type": mime[path.extname(target)] || "application/octet-stream" });
    fs.createReadStream(target).pipe(res);
});

(async () => {
    await new Promise((resolve) => server.listen(3011, "127.0.0.1", resolve));
    const browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
    try {
        for (const width of [360, 390, 412, 680, 768, 1440]) {
            const page = await browser.newPage();
            await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
            await page.goto("http://127.0.0.1:3011/reseller", { waitUntil: "domcontentloaded", timeout: 30000 });
            await new Promise((resolve) => setTimeout(resolve, 900));
            const state = await page.evaluate(() => {
                const nodes = [...document.querySelectorAll(".rs-universe-node")].map((el) => {
                    const r = el.getBoundingClientRect();
                    return { cls: [...el.classList].find((name) => name.startsWith("rs-universe-node-")), height: Math.round(r.height), width: Math.round(r.width) };
                });
                const stage = document.querySelector(".rs-universe-stage");
                return { nodes, stage: stage ? { clientWidth: stage.clientWidth, scrollWidth: stage.scrollWidth } : null };
            });
            const heights = state.nodes.map((node) => node.height);
            const maxDelta = heights.length ? Math.max(...heights) - Math.min(...heights) : 0;
            if (maxDelta > 8) throw new Error(`Voucher/category node height anomaly at ${width}px: ${JSON.stringify(state)}`);
            if (width <= 680 && state.stage && state.stage.scrollWidth > state.stage.clientWidth + 1) throw new Error(`universe overflow at ${width}px: ${JSON.stringify(state.stage)}`);

            if (width <= 680) {
                const storySelectors = {
                    transactions: ".rs-transaction-bar",
                    bills: ".rs-bill-flow-line",
                    catalog: ".rs-catalog-tile.is-active",
                    pricing: ".rs-price-row strong.rs-story-loop",
                    wallet: ".rs-flow-svg.is-valid .rs-flow-path",
                    api: ".rs-flow-svg.is-valid .rs-flow-path"
                };
                for (const [story, selector] of Object.entries(storySelectors)) {
                    await page.evaluate((storyName) => document.querySelector(`[data-showcase-story="${storyName}"]`)?.scrollIntoView({ block: "center", behavior: "instant" }), story);
                    await new Promise((resolve) => setTimeout(resolve, 700));
                    const storyState = await page.evaluate(({ storyName, animationSelector }) => {
                        const card = document.querySelector(`[data-showcase-story="${storyName}"]`);
                        const animated = card?.querySelector(animationSelector);
                        const rect = card?.getBoundingClientRect();
                        const style = animated ? getComputedStyle(animated) : null;
                        return {
                            inViewport: Boolean(rect && rect.bottom > 0 && rect.top < innerHeight),
                            active: Boolean(card?.classList.contains("rs-story-in-viewport")),
                            animationName: style?.animationName || "none",
                            playState: style?.animationPlayState || "paused"
                        };
                    }, { storyName: story, animationSelector: selector });
                    if (!storyState.inViewport || !storyState.active || storyState.animationName === "none" || storyState.playState !== "running") {
                        throw new Error(`mobile showcase animation missing for ${story} at ${width}px: ${JSON.stringify(storyState)}`);
                    }
                }
            }

            if (width >= 1440) {
                await page.evaluate(() => document.querySelector(".rs-universe-stage")?.scrollIntoView({ block: "center", behavior: "instant" }));
                await new Promise((resolve) => setTimeout(resolve, 700));
                const flowState = await page.evaluate(() => {
                    const stage = document.querySelector(".rs-universe-stage");
                    const svg = stage?.querySelector(".rs-universe-flow-svg");
                    const path = svg?.querySelector(".rs-flow-path");
                    const style = path ? getComputedStyle(path) : null;
                    const nodes = [...stage.querySelectorAll(".rs-universe-node")];
                    return {
                        valid: Boolean(svg?.classList.contains("is-valid")),
                        paths: svg?.querySelectorAll(".rs-flow-path").length || 0,
                        animationName: style?.animationName || "none",
                        playState: style?.animationPlayState || "paused",
                        nodeAnimations: nodes.map((node) => getComputedStyle(node).animationName)
                    };
                });
                if (!flowState.valid || flowState.paths !== 6 || flowState.animationName === "none" || flowState.playState !== "running" || flowState.nodeAnimations.some((name) => name === "none")) {
                    throw new Error(`universe/card animation missing: ${JSON.stringify(flowState)}`);
                }
            }
            console.log(`width=${width} nodeHeights=${heights.join(",")} maxDelta=${maxDelta}`);
            await page.close();
        }
        console.log("PASS qa_reseller_visual_regression");
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
})().catch((error) => {
    console.error(`FAIL qa_reseller_visual_regression: ${error.message}`);
    process.exit(1);
});
