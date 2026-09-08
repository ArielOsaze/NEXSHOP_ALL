"use strict";

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");
const puppeteer = require(path.join(__dirname, "..", "nexshop-backend", "node_modules", "puppeteer-core"));

const root = path.join(__dirname, "..");
const frontend = path.join(root, "nexshop-frontend");
const chrome = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe"
].find(fs.existsSync);
const fixtureToken = "00020101021226680016COM.NEXSHOP.QRIS0118936000000000000000000208FIXTURE5204581253033605802ID5912NEXSHOP QA6007JAKARTA6105123456304ABCD";

const overview = {
    user: {
        reseller_status: "approved",
        reseller_tier: "silver",
        fullname: "Fixture Mitra",
        email: "fixture@example.test",
        phone: "081234567890",
        phone_normalized: "6281234567890",
        member_code: "NX-FIXTURE",
        balance: 100000
    },
    metrics: { today: { count: 0, amount: 0 }, yesterday: { count: 0, amount: 0 }, this_month: { count: 0, amount: 0 }, last_month: { count: 0, amount: 0 } },
    indicators: { ip_whitelist_active: false, webhook_configured: false, two_factor_available: false },
    products: [],
    orders: [],
    news: []
};

function serve() {
    return http.createServer((req, res) => {
        const url = new URL(req.url, "http://127.0.0.1");
        const json = (status, body) => {
            res.writeHead(status, { "content-type": "application/json" });
            res.end(JSON.stringify(body));
        };
        if (url.pathname === "/api/reseller/portal/overview") return json(200, overview);
        if (url.pathname === "/api/reseller/portal/products") return json(200, { products: [], total_products: 0 });
        if (url.pathname === "/api/reseller/tiers") return json(200, []);
        if (url.pathname === "/api/settings/store") return json(200, { store_name: "NexShop", contact_whatsapp: "628123456789" });
        if (url.pathname === "/api/wallet/topup" && req.method === "POST") {
            let body = "";
            req.setEncoding("utf8");
            req.on("data", (chunk) => { body += chunk; });
            req.on("end", () => {
                const payload = JSON.parse(body || "{}");
                if (payload.payment_method === "bca") {
                    return json(201, { topup_id: "WT-FIXTURE-BCA", amount: 100000, is_direct: true, payment_no: "8801000000012345", payment_name: "BCA Virtual Account", expired: "2099-12-31 23:59:59" });
                }
                if (payload.payment_method === "mandiri") {
                    return json(201, { topup_id: "WT-FIXTURE-MANDIRI", amount: 100000, is_direct: true, payment_no: "8950800000012345", payment_name: "Mandiri Virtual Account", expired: "2099-12-31 23:59:59" });
                }
                return json(201, { topup_id: "WT-FIXTURE", amount: 100000, is_direct: true, qr_image: fixtureToken, qr_content: null, payment_no: null });
            });
            return;
        }
        if (url.pathname === "/api/wallet/topup/WT-FIXTURE") return json(200, { status: "PENDING" });
        if (url.pathname === "/api/wallet/topup/WT-FIXTURE-BCA") return json(200, { status: "PENDING" });
        if (url.pathname === "/api/wallet/topup/WT-FIXTURE-MANDIRI") return json(200, { status: "PENDING" });
        if (url.pathname.startsWith("/api/")) return json(200, {});

        const clean = url.pathname === "/portal-reseller" ? "/portal-reseller.html" : url.pathname;
        const file = path.resolve(frontend, `.${clean}`);
        if (!file.startsWith(frontend) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
            res.writeHead(404);
            return res.end("not found");
        }
        const ext = path.extname(file);
        const contentType = ext === ".html" ? "text/html" : ext === ".css" ? "text/css" : ext === ".js" ? "application/javascript" : "application/octet-stream";
        res.writeHead(200, { "content-type": contentType, "cache-control": "no-store" });
        res.end(fs.readFileSync(file));
    });
}

(async () => {
    assert(chrome, "Chrome/Edge executable tidak ditemukan");
    const server = serve();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox"] });
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
        await page.goto(`http://127.0.0.1:${port}/portal-reseller`, { waitUntil: "domcontentloaded" });
        await page.evaluate(() => sessionStorage.setItem("nexshop-reseller-token", "fixture-portal-token"));
        await page.reload({ waitUntil: "networkidle0" });
        await page.waitForFunction(() => getComputedStyle(document.querySelector("#sectionDashboard")).display === "flex", { timeout: 10000 });
        await page.evaluate(() => window.switchConsoleView("view-deposit"));
        await page.waitForFunction(() => getComputedStyle(document.querySelector("#view-deposit")).display !== "none", { timeout: 3000 });

        const pageErrors = [];
        page.on("pageerror", (error) => pageErrors.push(error.message));
        page.on("console", (message) => { if (message.type() === "error") pageErrors.push(message.text()); });

        await page.click('#formDepositSimulator [data-deposit-method="bca"]');
        const bcaState = await page.$eval('#formDepositSimulator [data-deposit-method="bca"]', (node) => ({ selected: node.classList.contains("is-selected"), pressed: node.getAttribute("aria-pressed"), outline: getComputedStyle(node).boxShadow }));
        assert.deepStrictEqual({ selected: bcaState.selected, pressed: bcaState.pressed }, { selected: true, pressed: "true" });
        assert.notStrictEqual(bcaState.outline, "none");

        await page.click('#formDepositSimulator [data-deposit-method="qris"]');
        page.on("request", (request) => {
            if (request.url().includes("/api/wallet")) console.log(`fixture_request=${request.method()} ${request.url()}`);
        });
        await page.evaluate(() => document.getElementById("formDepositSimulator").requestSubmit());
        try {
            await page.waitForFunction(() => getComputedStyle(document.querySelector("#depositQrisCard")).display !== "none", { timeout: 5000 });
        } catch (error) {
            const snapshot = await page.evaluate(() => ({
                form: document.querySelector("#formDepositSimulator")?.outerHTML.slice(0, 600),
                formDisplay: getComputedStyle(document.querySelector("#formDepositSimulator"))?.display,
                qrisDisplay: getComputedStyle(document.querySelector("#depositQrisCard"))?.display,
                submitDisabled: document.querySelector("#btnSubmitDeposit")?.disabled,
                qrisToken: document.querySelector("#resellerQrisTokenValue")?.textContent,
                selected: window.selectedDepositMethod
            }));
            throw new Error(`${error.message}; snapshot=${JSON.stringify(snapshot)} pageErrors=${JSON.stringify(pageErrors)}`);
        }
        const qrisState = await page.evaluate(() => ({
            token: document.querySelector("#resellerQrisTokenValue")?.textContent,
            tokenVisible: !document.querySelector("#resellerQrisToken")?.hidden,
            image: document.querySelector("#resellerQrisImage")?.getAttribute("src"),
            qrisSelected: document.querySelector('#formDepositSimulator [data-deposit-method="qris"]')?.classList.contains("is-selected"),
            bcaSelected: document.querySelector('#formDepositSimulator [data-deposit-method="bca"]')?.classList.contains("is-selected")
        }));
        assert.strictEqual(qrisState.token, fixtureToken);
        assert.strictEqual(qrisState.tokenVisible, true);
        assert(qrisState.image.includes("api.qrserver.com"), "token mentah harus dirender menjadi QR image");
        assert.strictEqual(qrisState.qrisSelected, true);
        assert.strictEqual(qrisState.bcaSelected, false);

        await page.click('#depositQrisCard [data-csp-onclick="h97c31caad6d751"]');
        await page.click('#formDepositSimulator [data-deposit-method="bca"]');
        await page.evaluate(() => document.getElementById("formDepositSimulator").requestSubmit());
        await page.waitForFunction(() => document.querySelector("#depositVaCard")?.hidden === false, { timeout: 5000 });
        const bcaVa = await page.evaluate(() => ({
            number: document.querySelector("#resellerVaNumber")?.textContent,
            bank: document.querySelector("#resellerVaBank")?.textContent,
            amount: document.querySelector("#resellerVaAmount")?.textContent
        }));
        assert.strictEqual(bcaVa.number, "8801000000012345");
        assert.strictEqual(bcaVa.bank, "BCA Virtual Account");
        assert.strictEqual(bcaVa.amount, "Rp 100.000");

        await page.click('#depositVaCard [data-csp-onclick="h97c31caad6d751"]');
        await page.click('#formDepositSimulator [data-deposit-method="mandiri"]');
        await page.evaluate(() => document.getElementById("formDepositSimulator").requestSubmit());
        await page.waitForFunction(() => document.querySelector("#depositVaCard")?.hidden === false, { timeout: 5000 });
        const mandiriVa = await page.evaluate(() => ({
            number: document.querySelector("#resellerVaNumber")?.textContent,
            bank: document.querySelector("#resellerVaBank")?.textContent
        }));
        assert.strictEqual(mandiriVa.number, "8950800000012345");
        assert.strictEqual(mandiriVa.bank, "Mandiri Virtual Account");
        console.log("PASS qa_portal_deposit_qris_browser: selected outline dan token QRIS terlihat pada fixture browser");
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
})().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
});
