const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8").replace(/\r\n/g, "\n");
const reseller = read("nexshop-frontend/reseller.html");
const resellerCss = read("nexshop-frontend/reseller.css");
const portal = read("nexshop-frontend/portal-reseller.html");
const portalCss = read("nexshop-frontend/portal-reseller.css");
const homepageJs = read("nexshop-frontend/script.js");
const homepageCss = read("nexshop-frontend/style.css");
const adminHtml = read("nexshop-frontend/admin/dashboard.html");
const adminJs = read("nexshop-frontend/admin/js/dashboard.js");

function assert(ok, message) {
    if (!ok) throw new Error(message);
}

assert(/class="rs-brand-mark"[\s\S]*<img/.test(reseller), "reseller brand logo markup missing");
assert(/\.rs-brand-mark img\s*\{[\s\S]*border-radius\s*:\s*(?:[6-9]|1[0-2])px/.test(resellerCss), "reseller logo must use a light rounded-square radius");
assert(/\.tv-auth-card-logo\s*\{[\s\S]*border-radius\s*:\s*(?:[6-9]|1[0-2])px/.test(portalCss), "portal auth logo must use a light rounded-square radius");
assert(/\.tv-brand-logo-wrap img\s*\{[\s\S]*border-radius\s*:\s*(?:[6-9]|1[0-2])px/.test(portalCss), "portal sidebar logo must use a light rounded-square radius");
assert(!/\.rs-brand-mark img\s*\{[^}]*border-radius\s*:\s*9999px/s.test(resellerCss), "reseller logo must not become circular");
assert(!/\.tv-auth-card-logo\s*\{[^}]*border-radius\s*:\s*9999px/s.test(portalCss), "portal auth logo must not become circular");

for (const rank of [1, 2, 3]) {
    assert(new RegExp(`hof-podium-card--${rank}`).test(homepageJs), `Hall of Fame rank ${rank} card class missing`);
    assert(new RegExp(`\\.hof-podium-card--${rank}\\s*\\{[\\s\\S]*?(?:border|box-shadow)`).test(homepageCss), `Hall of Fame rank ${rank} frame style missing`);
}
const rank2Frame = homepageCss.match(/\.hof-podium-card--2\s*\{[\s\S]*?\n\}/)?.[0] || "";
assert(/2563eb|1d4ed8|4f46e5|6366f1|sapphire|indigo/i.test(rank2Frame), "Hall of Fame rank 2 must have an explicit sapphire/indigo frame palette");
assert(!/silver|cbd5e1|94a3b8|e2e8f0|slate/i.test(rank2Frame), "Hall of Fame rank 2 must not use a silver/slate frame palette");
assert(/hof-podium-card--1[\s\S]*?(?:gold|fbbf24|f59e0b|amber)/i.test(homepageCss), "Hall of Fame rank 1 must have an explicit gold frame palette");
assert(/hof-podium-card--3[\s\S]*?(?:bronze|f97316|ea580c|orange)/i.test(homepageCss), "Hall of Fame rank 3 must have an explicit bronze frame palette");

assert(/id="tvDepositNominal"[^>]+min="100000"[^>]+value="100000"/.test(adminHtml), "Deposit nominal must follow current provider minimum");
assert(/id="tvDepositKode"[\s\S]*?<\/select>/.test(adminHtml), "Deposit payment method must be an option select");
assert(/<option[^>]+value="qris"/i.test(adminHtml), "Deposit select must include QRIS option");
assert(/syncTvDepositNominalLimits/.test(adminJs), "Deposit nominal limits must follow the selected provider method");
assert(/<option[^>]+value="[A-Za-z0-9_-]+"/.test(adminHtml), "Deposit select must contain provider method codes");
assert(/const kodeSelect = document\.getElementById\("tvDepositKode"\)/.test(adminJs), "Deposit submit must read selected payment code");
assert(/JSON\.stringify\(\{\s*nominal,\s*kode,\s*security_pin\s*\}\)/.test(adminJs), "Deposit submit must send the selected kode to backend");
assert(/tvDepositPaymentMethod|data\.metode/.test(adminJs), "Deposit result must show payment method");
assert(/tvDepositNominalResult|data\.nominal/.test(adminJs), "Deposit result must show requested nominal");
assert(/tvDepositUniqueCode|data\.kode_unik/.test(adminJs), "Deposit result must show unique code");
assert(/tvDepositAdminFee|data\.biaya_admin/.test(adminJs), "Deposit result must show admin fee");

const controller = read("nexshop-backend/controllers/topupController.js");
assert(/TOKOVOUCHER_DEPOSIT_CODES\s*=\s*new Set/.test(controller), "Deposit codes must be server-side allowlisted");
assert(/TOKOVOUCHER_DEPOSIT_CODES\.has\(kode\)/.test(controller), "Deposit controller must reject unlisted payment codes");

console.log("PASS sim81: rounded-square reseller/portal logos, ranked Hall of Fame frames, and option-based TokoVoucher deposit");
