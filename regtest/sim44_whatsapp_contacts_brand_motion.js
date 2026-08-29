const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const migration = read("nexshop-backend/migrations/022_create_whatsapp_contacts.sql");
const contactService = read("nexshop-backend/services/whatsappContactService.js");
const contactController = read("nexshop-backend/controllers/whatsappContactController.js");
const contactRoutes = read("nexshop-backend/routes/whatsappContactRoutes.js");
const server = read("nexshop-backend/server.js");
const phoneOtp = read("nexshop-backend/services/phoneOtpService.js");
const adminHtml = read("nexshop-frontend/admin/dashboard.html");
const adminJs = read("nexshop-frontend/admin/js/dashboard.js");
const publicHtml = read("nexshop-frontend/index.html");
const publicCss = read("nexshop-frontend/style.css");
const adminCss = read("nexshop-frontend/admin/css/style.css");

assert.match(migration, /create table if not exists (?:public\.)?whatsapp_contacts/i);
assert.match(migration, /user_id\s+bigint[^\n]+references\s+public\.users/i);
assert.match(migration, /phone_e164\s+text\s+not null/i);
assert.match(migration, /unique/i);
assert.match(contactService, /upsertVerifiedUserContact/);
assert.match(contactService, /phone_verified_at/);
assert.match(contactService, /phone_normalized/);
assert.match(contactService, /toVCard/);
assert.match(contactService, /BEGIN:VCARD/);
assert.match(contactController, /list/);
assert.match(contactController, /exportVCard/);
assert.match(contactRoutes, /superAdminMiddleware/);
assert.match(contactRoutes, /router\.get\("\/export\.vcf"/);
assert.match(server, /whatsappContactRoutes/);
assert.match(server, /app\.use\("\/api\/whatsapp\/contacts"/);
assert.match(phoneOtp, /upsertVerifiedUserContact/);
assert.match(adminHtml, /data-view="waContacts"/);
assert.match(adminHtml, /view-waContacts/);
assert.match(adminJs, /syncWhatsAppContactsToMobile/);
assert.match(adminJs, /loadWhatsAppContacts/);
assert.match(adminJs, /syncWhatsAppContactsToMobile/);
assert.match(publicHtml, /nx-brand-lockup/);
assert.match(publicHtml, /nx-brand-mark/);
assert.match(publicHtml, /nx-brand-name/);
assert.match(adminHtml, /nx-brand-lockup/);
assert.match(publicCss, /@keyframes nxBrandNameReveal/);
assert.match(publicCss, /prefers-reduced-motion/);
assert.match(adminCss, /@keyframes nxBrandNameReveal/);

console.log("sim44_whatsapp_contacts_brand_motion: passed");
