"use strict";

const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const puppeteer = require(path.join(__dirname, "..", "nexshop-backend", "node_modules", "puppeteer-core"));

const root = path.resolve(__dirname, "..");
const frontend = path.join(root, "nexshop-frontend");
const uploadSource = fs.readFileSync(path.join(root, "nexshop-backend", "controllers", "uploadController.js"), "utf8").replace(/\r\n/g, "\n");
const resellerSource = fs.readFileSync(path.join(root, "nexshop-backend", "controllers", "resellerController.js"), "utf8").replace(/\r\n/g, "\n");
const mime = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "text/javascript",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".woff2": "font/woff2"
};

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function json(res, status, body) {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        req.on("error", reject);
    });
}

const chromeCandidates = process.platform === "win32" ? [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
] : ["/usr/bin/google-chrome-stable", "/usr/bin/google-chrome", "/usr/bin/chromium"];
const executablePath = chromeCandidates.find(fs.existsSync);

console.log("NEXSHOP REGTEST 67: RESELLER AUTH, KYC STORAGE & RESPONSIVE FORM");

if (!executablePath) {
    console.log("SKIP sim67: Chrome/Chromium tidak ditemukan untuk behavioral browser test.");
    process.exit(0);
}

const state = {
    uploadMode: "error",
    uploads: [],
    registers: [],
    logins: []
};

const server = http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url, "http://127.0.0.1");
    const pathname = requestUrl.pathname;

    if (pathname === "/api/auth/public-config") {
        return json(res, 200, { turnstile_required: true, turnstile_site_key: "local-test-site-key" });
    }
    if (pathname === "/api/settings/store") {
        return json(res, 200, { store_name: "NexShop", contact_whatsapp: "628123456789" });
    }
    if (pathname === "/api/upload/image" && req.method === "POST") {
        await readBody(req);
        state.uploads.push({ query: requestUrl.search });
        if (state.uploadMode === "error") {
            return json(res, 503, {
                message: "Penyimpanan dokumen identitas belum siap di server. Hubungi admin NexShop.",
                code: "KYC_KEY_MISSING"
            });
        }
        return json(res, 200, { url: "kyc:kyc/2026-08/local-fixture.bin", encrypted: true });
    }
    if (pathname === "/api/reseller/auth/register" && req.method === "POST") {
        const body = JSON.parse(await readBody(req));
        state.registers.push(body);
        return json(res, 201, {
            message: "Akun Portal Reseller berhasil dibuat",
            requires_login: true,
            status: "pending",
            user: { email: body.email, fullname: body.fullname, reseller_status: "pending" }
        });
    }
    if (pathname === "/api/reseller/auth/login" && req.method === "POST") {
        const body = JSON.parse(await readBody(req));
        state.logins.push(body);
        return json(res, 200, {
            message: "Login Portal Reseller berhasil",
            token: "local-login-token",
            status: "approved",
            user: { email: body.email, fullname: "Mitra QA", reseller_status: "approved" }
        });
    }
    if (pathname === "/api/reseller/portal/overview") {
        if (req.headers.authorization !== "Bearer local-login-token") return json(res, 401, { message: "Sesi tidak valid" });
        return json(res, 200, {
            user: { email: "mitra.qa@example.test", fullname: "Mitra QA", phone: "08123456789", reseller_status: "approved", balance: 0 },
            metrics: { today: {}, yesterday: {}, this_month: {}, last_month: {}, daily_chart: [] },
            news: [], security_indicator: {}
        });
    }
    if (pathname.startsWith("/api/")) return json(res, 200, []);

    let relative = decodeURIComponent(pathname.replace(/^\//, ""));
    if (relative === "portal-reseller") relative = "portal-reseller.html";
    const target = path.resolve(frontend, relative || "index.html");
    if (!target.startsWith(frontend) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
        res.writeHead(404);
        return res.end("Not found");
    }
    res.writeHead(200, { "Content-Type": mime[path.extname(target)] || "application/octet-stream" });
    fs.createReadStream(target).pipe(res);
});

const fixturePath = path.join(os.tmpdir(), `sim67-local-${process.pid}.png`);
// 1x1 local fixture only; it never leaves this local mock server.
fs.writeFileSync(fixturePath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));

(async () => {
    let browser;
    try {
        await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
        const address = server.address();
        const baseUrl = `http://127.0.0.1:${address.port}`;
        browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
        const page = await browser.newPage();
        await page.setViewport({ width: 530, height: 900, deviceScaleFactor: 1 });
        await page.setRequestInterception(true);
        page.on("request", (request) => {
            if (request.url().includes("/auth-security.js")) {
                return request.respond({
                    status: 200,
                    contentType: "application/javascript",
                    body: "window.NexShopAuthSecurity={captchaToken:async()=>\"local-captcha\",resetCaptcha(){},mountCaptcha(){}};"
                });
            }
            return request.continue();
        });

        async function setValue(selector, value) {
            await page.$eval(selector, (el, nextValue) => {
                el.value = nextValue;
                el.dispatchEvent(new Event("input", { bubbles: true }));
                el.dispatchEvent(new Event("change", { bubbles: true }));
            }, value);
        }

        async function fillRegisterForm() {
            await setValue("#regEmail", "mitra.qa@example.test");
            await setValue("#regPassword", "PortalPass123!");
            await setValue("#regFullname", "Mitra QA");
            await setValue("#regWhatsapp", "08123456789");
            await setValue("#regNik", "3273010101010001");
            await setValue("#regStoreName", "Toko QA");
            await page.$eval("#ktpFile", (input) => input.value = "");
            await page.$("#ktpFile").then((input) => input.uploadFile(fixturePath));
            await page.waitForFunction(() => document.getElementById("ktpPreviewBox")?.style.display === "inline-block");
        }

        await page.goto(`${baseUrl}/portal-reseller?mode=register`, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForSelector("#formResellerRegister");
        const layout = await page.evaluate(() => {
            const card = document.querySelector(".tv-auth-card");
            const tabs = document.querySelector(".tv-auth-tabs");
            const grids = [...document.querySelectorAll(".tv-register-grid")];
            const countColumns = (value) => value.trim().split(/\s+/).filter(Boolean).length;
            return {
                cardWidth: card?.getBoundingClientRect().width || 0,
                containerType: card ? getComputedStyle(card).containerType : "",
                tabsDisplay: tabs ? getComputedStyle(tabs).display : "",
                tabsColumns: tabs ? countColumns(getComputedStyle(tabs).gridTemplateColumns) : 0,
                gridColumns: grids.map((grid) => countColumns(getComputedStyle(grid).gridTemplateColumns))
            };
        });
        assert(layout.cardWidth > 0 && layout.cardWidth < 560, `card test width tidak sesuai: ${JSON.stringify(layout)}`);
        assert(layout.containerType === "inline-size", `container query tidak aktif: ${JSON.stringify(layout)}`);
        assert(layout.tabsDisplay === "grid" && layout.tabsColumns === 1, `tab tidak menumpuk pada card sempit: ${JSON.stringify(layout)}`);
        assert(layout.gridColumns.length === 4 && layout.gridColumns.every((count) => count === 1), `field register masih multi-kolom: ${JSON.stringify(layout)}`);

        await fillRegisterForm();
        await page.$eval("#formResellerRegister", (form) => form.requestSubmit());
        await page.waitForFunction(() => {
            const el = document.getElementById("regErrorMsg");
            return el?.style.display === "block" && el.textContent.includes("Penyimpanan dokumen identitas belum siap");
        }, { timeout: 10000 });
        assert(state.uploads.length === 1 && state.uploads[0].query === "?type=kyc", `request upload KYC salah: ${JSON.stringify(state.uploads)}`);
        assert(state.registers.length === 0, "register tidak boleh dipanggil jika upload KYC gagal");
        assert(await page.evaluate(() => localStorage.getItem("nexshop-reseller-token")) === null, "error KYC tidak boleh membuat sesi portal");

        state.uploadMode = "success";
        await page.evaluate(() => localStorage.clear());
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForSelector("#formResellerRegister");
        await fillRegisterForm();
        await page.$eval("#formResellerRegister", (form) => form.requestSubmit());
        await page.waitForFunction(() => {
            const err = document.getElementById("loginErrorMsg");
            return localStorage.getItem("nexshop-reseller-token") === null
                && document.getElementById("authPaneLogin")?.style.display === "block"
                && err?.textContent.includes("Pendaftaran berhasil");
        }, { timeout: 10000 });
        assert(state.registers.length === 1, "register endpoint tidak dipanggil setelah upload KYC sukses");
        assert(state.registers[0].captcha_token === "local-captcha", "register harus mengirim captcha token");
        assert(state.registers[0].ktp_url === "kyc:kyc/2026-08/local-fixture.bin", "register harus mengirim referensi KTP terenkripsi");

        await page.evaluate(() => localStorage.clear());
        await page.goto(`${baseUrl}/portal-reseller`, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForSelector("#formResellerLogin");
        await page.$eval("#tabBtnRegister", (button) => button.click());
        await page.waitForFunction(() => document.getElementById("authPaneRegister")?.style.display === "block");
        await page.$eval("#tabBtnLogin", (button) => button.click());
        await setValue("#loginEmail", "mitra.qa@example.test");
        await setValue("#loginPassword", "PortalPass123!");
        await page.$eval("#formResellerLogin", (form) => form.requestSubmit());
        await page.waitForFunction(() => localStorage.getItem("nexshop-reseller-token") === "local-login-token", { timeout: 10000 });
        assert(state.logins.length === 1, "login endpoint tidak dipanggil");
        assert(state.logins[0].captcha_token === "local-captcha", "login harus mengirim captcha token");
        assert(state.logins[0].email === "mitra.qa@example.test", "login harus memakai email portal");
        assert(state.uploads.length === 2, "login tidak boleh memicu upload KYC tambahan");

        assert(uploadSource.includes('const KYC_BUCKET = process.env.SUPABASE_KYC_BUCKET || "kyc-documents";'), "jalur KYC harus memakai bucket privat dedicated");
        assert(uploadSource.includes('code: kunciErr.code'), "error key KYC harus mengembalikan kode diagnostik aman");
        assert(resellerSource.includes('const { data: portalAccount, error: portalErr } = await supabase'), "login harus membaca dedicated portal account");
        assert(resellerSource.includes('code: "PORTAL_2FA_REQUIRED"'), "login harus mempertahankan challenge 2FA server-side");

        console.log("PASS sim67: browser behavior, CSS container query, KYC error/success, dan portal login tervalidasi.");
    } finally {
        if (browser) await browser.close();
        await new Promise((resolve) => server.close(resolve));
        try { fs.unlinkSync(fixturePath); } catch (_) {}
    }
})().catch((error) => {
    console.error(error.stack || error.message || error);
    process.exit(1);
});
