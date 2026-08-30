"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const puppeteer = require(path.join(__dirname, "..", "nexshop-backend", "node_modules", "puppeteer-core"));

const root = path.resolve(__dirname, "..");
const frontend = path.join(root, "nexshop-frontend");
const chromeCandidates = process.platform === "win32"
    ? [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
    ]
    : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
const executablePath = chromeCandidates.find(fs.existsSync);

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function sendJson(res, payload) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
}

function contentType(file) {
    return file.endsWith(".html") ? "text/html; charset=utf-8"
        : file.endsWith(".js") ? "application/javascript; charset=utf-8"
            : file.endsWith(".css") ? "text/css; charset=utf-8"
                : "application/octet-stream";
}

if (!executablePath) {
    console.log("SKIP qa_checkout_identity_qris_browser: Chrome/Chromium tidak ditemukan.");
    process.exit(0);
}

const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/api/users/me") {
        return sendJson(res, {
            user: {
                id: "fixture-user",
                fullname: "Fixture User",
                email: "fixture@example.test",
                phone: "+6281234567890",
                phone_normalized: "6281234567890",
                has_verified_phone: true
            }
        });
    }
    if (url.pathname.startsWith("/api/")) {
        return sendJson(res, { items: [], total: 0, has_more: false, page: 1 });
    }

    let relative = decodeURIComponent(url.pathname.replace(/^\//, ""));
    if (!relative || relative === "marketplace") relative = "marketplace.html";
    const target = path.resolve(frontend, relative);
    if (!target.startsWith(frontend) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
        res.writeHead(404);
        return res.end("Not found");
    }
    res.writeHead(200, { "Content-Type": contentType(target) });
    fs.createReadStream(target).pipe(res);
});

(async () => {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const origin = `http://127.0.0.1:${address.port}`;
    const browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
    const errors = [];
    try {
        const index = await browser.newPage();
        index.on("pageerror", error => errors.push(`index: ${error.message}`));
        await index.evaluateOnNewDocument(() => {
            localStorage.setItem("nexshop-public-token", "fixture-token");
            localStorage.setItem("nexshop_user", JSON.stringify({
                id: "fixture-user",
                fullname: "Fixture User",
                email: "fixture@example.test",
                phone: "+6281234567890",
                phone_normalized: "6281234567890",
                has_verified_phone: true
            }));
        });
        await index.goto(`${origin}/index.html`, { waitUntil: "domcontentloaded" });
        const loggedTopup = await index.evaluate(async () => {
            await window.openGameDetail("Fixture", {
                kategori: "Fixture",
                logo: "/images/nexshop-logo.webp",
                products: [{ kode_produk: "FIXTURE", nama: "Fixture", harga_jual: 1000, butuh_server_id: false }]
            });
            const email = document.getElementById("twEmail");
            const phone = document.getElementById("twPhone");
            return {
                email: email.value,
                phone: phone.value,
                emailHidden: email.closest(".tw-field-group").classList.contains("hidden"),
                phoneHidden: phone.closest(".tw-field-group").classList.contains("hidden"),
                emailRequired: email.required,
                phoneRequired: phone.required
            };
        });
        assert(loggedTopup.email === "fixture@example.test", "Logged-in topup did not use profile email");
        assert(loggedTopup.phone === "6281234567890", "Logged-in topup did not use profile WhatsApp");
        assert(loggedTopup.emailHidden && loggedTopup.phoneHidden, "Logged-in topup identity fields remain visible");
        assert(!loggedTopup.emailRequired && !loggedTopup.phoneRequired, "Logged-in topup identity fields remain required");

        const guestContext = await browser.createBrowserContext();
        const guestIndex = await guestContext.newPage();
        guestIndex.on("pageerror", error => errors.push(`guest-index: ${error.message}`));
        await guestIndex.goto(`${origin}/index.html`, { waitUntil: "domcontentloaded" });
        const guestTopup = await guestIndex.evaluate(async () => {
            await window.openGameDetail("Fixture", {
                kategori: "Fixture",
                logo: "/images/nexshop-logo.webp",
                products: [{ kode_produk: "FIXTURE", nama: "Fixture", harga_jual: 1000, butuh_server_id: false }]
            });
            const email = document.getElementById("twEmail");
            const phone = document.getElementById("twPhone");
            return {
                emailHidden: email.closest(".tw-field-group").classList.contains("hidden"),
                phoneHidden: phone.closest(".tw-field-group").classList.contains("hidden"),
                emailRequired: email.required,
                phoneRequired: phone.required
            };
        });
        assert(!guestTopup.emailHidden && !guestTopup.phoneHidden, "Guest topup identity fields are hidden");
        assert(guestTopup.emailRequired && guestTopup.phoneRequired, "Guest topup email/WhatsApp are not mandatory");
        await guestIndex.close();
        await guestContext.close();

        const marketplace = await browser.newPage();
        marketplace.on("pageerror", error => errors.push(`marketplace: ${error.message}`));
        await marketplace.evaluateOnNewDocument(() => {
            localStorage.setItem("nexshop-public-token", "fixture-token");
            localStorage.setItem("nexshop_user", JSON.stringify({
                id: "fixture-user", email: "fixture@example.test", phone: "+6280000000000"
            }));
        });
        await marketplace.goto(`${origin}/marketplace.html`, { waitUntil: "domcontentloaded" });
        const loggedMarketplace = await marketplace.evaluate(() => {
            window.openMarketplaceCheckout({
                operator: "Fixture Operator", nama: "Fixture Product", harga_jual: 1000,
                kode_produk: "FIXTURE", kategori: "Pulsa", checkout_contract: {
                    target: { visible: true, required: true }, server_id: { visible: false, required: false }
                }
            });
            const email = document.getElementById("mktCheckoutEmail");
            const phone = document.getElementById("mktCheckoutPhone");
            return {
                email: email.value,
                phone: phone.value,
                emailHidden: document.getElementById("mktCheckoutEmailGroup").classList.contains("hidden"),
                phoneHidden: document.getElementById("mktCheckoutPhoneGroup").classList.contains("hidden"),
                emailRequired: email.required,
                phoneRequired: phone.required
            };
        });
        assert(loggedMarketplace.email === "fixture@example.test", "Logged-in marketplace did not use profile email");
        assert(loggedMarketplace.phone === "6280000000000", "Logged-in marketplace did not use profile WhatsApp");
        assert(loggedMarketplace.emailHidden && loggedMarketplace.phoneHidden, "Logged-in marketplace identity fields remain visible");
        assert(!loggedMarketplace.emailRequired && !loggedMarketplace.phoneRequired, "Logged-in marketplace identity fields remain required");

        const guestMarketplace = await marketplace.evaluate(() => {
            window.NexShopCheckoutHelpers.toggleCheckoutIdentityFields({
                user: null, emailId: "mktCheckoutEmail", phoneId: "mktCheckoutPhone", wrapperSelector: "label"
            });
            return {
                emailHidden: document.getElementById("mktCheckoutEmailGroup").classList.contains("hidden"),
                phoneHidden: document.getElementById("mktCheckoutPhoneGroup").classList.contains("hidden"),
                emailRequired: document.getElementById("mktCheckoutEmail").required,
                phoneRequired: document.getElementById("mktCheckoutPhone").required
            };
        });
        assert(!guestMarketplace.emailHidden && !guestMarketplace.phoneHidden, "Guest marketplace identity fields are hidden");
        assert(guestMarketplace.emailRequired && guestMarketplace.phoneRequired, "Guest marketplace email/WhatsApp are not mandatory");

        const qr = await marketplace.evaluate(() => {
            const source = document.createElement("canvas");
            source.width = 200;
            source.height = 200;
            const originalCreateElement = document.createElement.bind(document);
            const created = [];
            document.createElement = tag => {
                const element = originalCreateElement(tag);
                if (tag === "canvas") created.push(element);
                return element;
            };
            try {
                const dataUrl = window.NexShopCheckoutHelpers.createPaddedQrDataUrl(source, 32);
                return { source: [source.width, source.height], exported: [created[0].width, created[0].height], dataUrlLength: dataUrl.length };
            } finally {
                document.createElement = originalCreateElement;
            }
        });
        const imageQr = await marketplace.evaluate(async () => {
            const source = document.createElement("canvas");
            source.width = 200;
            source.height = 200;
            const image = new Image();
            image.src = source.toDataURL("image/png");
            await image.decode();
            const dataUrl = window.NexShopCheckoutHelpers.createPaddedQrDataUrl(image, 32);
            const exported = new Image();
            exported.src = dataUrl;
            await exported.decode();
            return [exported.naturalWidth, exported.naturalHeight];
        });
        assert(imageQr[0] === 264 && imageQr[1] === 264, "QRIS image fallback export is still cropped");
        assert(errors.length === 0, `Browser runtime errors: ${errors.join(" | ")}`);
        console.log("PASS qa_checkout_identity_qris_browser: topup/marketplace logged-in vs guest fields and padded QR export");
    } finally {
        await browser.close();
        server.close();
    }
})().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
