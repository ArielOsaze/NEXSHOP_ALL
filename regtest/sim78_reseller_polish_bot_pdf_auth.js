"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const https = require("https");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8").replace(/\r\n/g, "\n");
const portal = read("nexshop-frontend/portal-reseller.html");
const portalCss = read("nexshop-frontend/portal-reseller.css");
const docs = read("nexshop-frontend/docs-reseller.html");
const docsCss = read("nexshop-frontend/docs-reseller.css");
const pdfService = read("nexshop-backend/services/seoThumbnailService.js");
const pdfController = read("nexshop-backend/controllers/docsController.js");
const portalMiddleware = read("nexshop-backend/middleware/resellerPortalAuthMiddleware.js");
const resellerController = read("nexshop-backend/controllers/resellerController.js");
const registerSource = resellerController.slice(resellerController.indexOf("exports.resellerRegister"), resellerController.indexOf("exports.resellerLogin"));
const registerHandler = portal.slice(portal.indexOf("// ── Submit Register ──"), portal.indexOf("// ── Submit Login ──"));
const aiController = read("nexshop-backend/controllers/aiController.js");
const engine = require(path.join(root, "nexshop-backend/utils/nexbotEngine"));

let passed = 0;
function check(label, condition) {
    if (!condition) {
        console.error(`FAIL sim78: ${label}`);
        process.exitCode = 1;
        return;
    }
    passed += 1;
    console.log(`PASS sim78: ${label}`);
}

// These are the exact legacy colors that were visible in the light portal
// through inline styles and old embedded rules.
const staleLightSurfaceColors = /#94a3b8|#cbd5e1|rgba\(255,\s*255,\s*255,\s*0\.0[3-8]\)/i;
check("portal tidak menyimpan muted dark-theme yang samar pada surface putih", !staleLightSurfaceColors.test(portal));
check("portal CSS memiliki guard untuk dynamic inline text color", /\[style\*=[^\]]*94a3b8|\[style\*=[^\]]*cbd5e1/i.test(portalCss));
check("API docs memakai selector theme reseller untuk endpoint/code/table", /docs-endpoint-card|docs-code|docs-api/i.test(docsCss) && /docs-endpoint-card|docs-code|docs-api/i.test(docs));
check("PDF link publik dan header attachment tersedia", docs.includes('href="/api/docs/reseller.pdf"') && /Content-Type[\s\S]{0,80}application\/pdf/.test(pdfController) && /Content-Disposition[\s\S]{0,100}attachment/.test(pdfController));
const pdfRenderSource = pdfService.slice(pdfService.indexOf("async function renderResellerDocsPdf"), pdfService.indexOf("async function getResellerDocsPdf"));
check("PDF renderer tidak memakai inline style yang diblokir CSP", !/addStyleTag\(/.test(pdfRenderSource) && /media="print"[^>]+docs-reseller-print\.css/.test(docs));
check("middleware selalu mengikat token ke identity portal yang terdaftar", /reseller_portal_accounts/.test(portalMiddleware) && /portal_account_id/.test(portalMiddleware) && /user_id/.test(portalMiddleware) && /account_scope/.test(portalMiddleware));
check("register tidak auto-login atau mengeluarkan access token", /requires_login:\s*true/.test(registerSource) && !/\n\s*token,/.test(registerSource) && !/setResellerSession\(data\.token/.test(registerHandler));
check("NexBot mengenali pola pertanyaan menghubungi CS dan membersihkan reasoning provider", /function isContactQuery/.test(aiController) && /menghubungi/.test(aiController) && /stripProviderReasoning/.test(aiController));

const webhookQuery = engine.normalizeQuery("bagaimana cara verifikasi signature webhook NexShop?");
const webhookRanked = engine.rankKnowledge([
    { id: "canonical-webhook", title: "Verifikasi Signature Webhook Reseller NexShop", category: "Security", keywords: "webhook callback signature hmac verifikasi x-nexshop-signature", content: "HMAC_SHA256(webhook_secret, raw_body)", priority: 10 },
    { id: "registration", title: "Pendaftaran dan KYC Portal Reseller NexShop", category: "Guide", keywords: "cara daftar reseller verifikasi akun", content: "Pendaftaran akun", priority: 8 },
], webhookQuery, engine.detectIntent(webhookQuery), engine.detectEntities(webhookQuery));
check("NexBot memprioritaskan knowledge webhook yang paling relevan", webhookRanked[0]?.id === "canonical-webhook");

function get(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            const chunks = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
        }).on("error", reject);
    });
}

async function liveChecks() {
    const pdf = await get("https://nexshop.cloud/api/docs/reseller.pdf");
    check("LIVE PDF mengembalikan HTTP 200", pdf.status === 200);
    check("LIVE PDF memiliki content-type dan signature PDF", /^application\/pdf/i.test(String(pdf.headers["content-type"] || "")) && pdf.body.subarray(0, 5).toString() === "%PDF-");
    check("LIVE PDF memiliki Content-Disposition attachment", /attachment/i.test(String(pdf.headers["content-disposition"] || "")));
}

(async () => {
    if (process.argv.includes("--live")) await liveChecks();
    console.log(`sim78 summary: ${passed} checks passed`);
    if (process.exitCode) process.exit(1);
})().catch((error) => {
    console.error(`FAIL sim78: ${error.stack || error.message}`);
    process.exit(1);
});
