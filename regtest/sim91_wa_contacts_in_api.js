const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8").replace(/\r\n/g, "\n");

const adminHtml = read("nexshop-frontend/admin/dashboard.html");
const adminJs = read("nexshop-frontend/admin/js/dashboard.js");
const marketingController = read("nexshop-backend/controllers/waMarketingController.js");
const marketingRoutes = read("nexshop-backend/routes/waCampaignRoutes.js");
const marketingService = read("nexshop-backend/services/waMarketingService.js");

const sidebar = adminHtml.match(/<ul class="nav flex-column" id="sidebarNav">([\s\S]*?)<\/ul>/)?.[1] || "";
const settingsGroup = sidebar.match(/data-nav-group-wrap="settings-approval"([\s\S]*?)<\/li>/)?.[1] || "";
const waApiView = adminHtml.match(/<section id="view-waApi"[\s\S]*?<\/section>/)?.[0] || "";

assert.doesNotMatch(sidebar, /sidebar-direct-contact/);
assert.doesNotMatch(sidebar, /data-view="waContacts"/);
assert.match(settingsGroup, /data-view="waApi"/);
assert.doesNotMatch(adminHtml, /Sync ke Mobile/);
assert.doesNotMatch(adminJs, /syncWhatsAppContactsToMobile/);
assert.match(waApiView, /Kontak Terverifikasi/);
assert.match(waApiView, /Sinkronkan ke WA API/);
assert.match(adminJs, /syncVerifiedContactsToWaApi/);
assert.match(adminJs, /\/wa-marketing\/contacts\/sync-verified/);
assert.match(marketingRoutes, /router\.post\("\/contacts\/sync-verified"/);
assert.match(marketingController, /syncVerifiedContacts/);
assert.match(marketingService, /syncVerifiedContacts/);
assert.match(marketingService, /whatsapp_contacts/);
assert.match(marketingService, /marketing_opt_in:\s*false/);

console.log("PASS sim91: verified WhatsApp contacts live inside WA API and sync server-side");
