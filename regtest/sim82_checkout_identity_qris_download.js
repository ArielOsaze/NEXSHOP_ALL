const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const indexHtml = fs.readFileSync(path.join(root, "nexshop-frontend", "index.html"), "utf8");
const scriptJs = fs.readFileSync(path.join(root, "nexshop-frontend", "script.js"), "utf8");
const marketplaceHtml = fs.readFileSync(path.join(root, "nexshop-frontend", "marketplace.html"), "utf8");
const portalHtml = fs.readFileSync(path.join(root, "nexshop-frontend", "portal-reseller.html"), "utf8");
const orderController = fs.readFileSync(path.join(root, "nexshop-backend", "controllers", "orderController.js"), "utf8");
const topupController = fs.readFileSync(path.join(root, "nexshop-backend", "controllers", "topupController.js"), "utf8");

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

// Guest identity must be mandatory in both storefront purchase surfaces.
assert(/id=\"twEmail\"[^>]*\brequired\b/.test(indexHtml), "Guest topup email must be required");
assert(/id=\"mktCheckoutEmail\"[^>]*\brequired\b/.test(marketplaceHtml), "Guest marketplace email must be required");
assert(/id=\"mktCheckoutPhone\"[^>]*\brequired\b/.test(marketplaceHtml), "Guest marketplace WhatsApp must be required");
assert(/id=\"portalPurchasePhoneRow\"[^>]*\bhidden\b/.test(portalHtml), "Portal logged-in purchase must not show WhatsApp field");
assert(/recipient_email:\s*currentResellerProfile\.email/.test(portalHtml) && /recipient_phone:\s*currentResellerProfile\.(phone_normalized|phone)/.test(portalHtml), "Portal purchase must use registered profile contact data");

// Logged-in checkout must hide identity fields and use the validated account identity.
assert(/toggleCheckoutIdentityFields/.test(scriptJs), "Topup must have a shared logged-in identity field policy");
assert(/toggleCheckoutIdentityFields/.test(marketplaceHtml), "Marketplace must have a logged-in identity field policy");
assert(/mktCurrentUser/.test(marketplaceHtml) && /user\?\.email|user\.email/.test(marketplaceHtml), "Marketplace must read logged-in email from account profile");
assert(/mktCurrentUser/.test(marketplaceHtml) && /user\?\.phone|user\.phone/.test(marketplaceHtml), "Marketplace must read logged-in WhatsApp from account profile");
assert(/getCheckoutIdentity\(userId\)/.test(orderController), "Marketplace backend must use server-side checkout identity");
assert(/getCheckoutIdentity\(userId\)/.test(topupController), "Topup backend must use server-side checkout identity");

// Both payment QRIS downloads must export a padded full QR image, not the raw edge canvas.
assert(/createPaddedQrDataUrl|quietZone|padding/.test(scriptJs), "Topup QRIS download must export a padded full image");
assert(/createPaddedQrDataUrl|quietZone|padding/.test(marketplaceHtml), "Marketplace QRIS download must export a padded full image");
assert(/createPaddedQrDataUrl\(img, 32\)/.test(scriptJs), "Topup QR image fallback must use padded export");
assert(/createPaddedQrDataUrl\(img, 32\)/.test(marketplaceHtml), "Marketplace QR image fallback must use padded export");

console.log("PASS sim82: logged-in checkout identity, mandatory guest contacts, and full QRIS downloads");
