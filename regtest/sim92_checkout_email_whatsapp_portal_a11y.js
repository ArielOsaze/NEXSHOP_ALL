"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8").replace(/\r\n/g, "\n");
const indexHtml = read("nexshop-frontend/index.html");
const checkoutIdentity = read("nexshop-frontend/checkout-identity.js");
const script = read("nexshop-frontend/script.js");
const style = read("nexshop-frontend/style.css");
const portalHtml = read("nexshop-frontend/portal-reseller.html");
const portalCss = read("nexshop-frontend/portal-reseller.css");
const portalUi = read("nexshop-frontend/portal-reseller-ui.js");
const userController = read("nexshop-backend/controllers/userController.js");
const otpService = read("nexshop-backend/services/phoneOtpService.js");
const phoneNumber = read("nexshop-backend/utils/phoneNumber.js");
const authController = read("nexshop-backend/controllers/authController.js");
const userRoutes = read("nexshop-backend/routes/userRoutes.js");
const emailValidation = require(path.join(root, "nexshop-backend/utils/emailValidation"));
const frontendIdentity = read("nexshop-frontend/checkout-identity.js");
const frontendContext = { window: {} };
vm.runInNewContext(frontendIdentity, frontendContext);

// BUG 1/2: both checkout inputs must share one readable, browser-tolerant validator.
assert.match(indexHtml, /checkout-identity\.js/);
assert.match(checkoutIdentity, /validateEmail/);
assert.match(script, /validateCheckoutEmail\(/);
assert.doesNotMatch(script, /email\.includes\(["']@["']\)/, "topup must not use ad-hoc email includes validation");
assert.match(style, /#twPromoCodeInput[^{]*\{|#promoCodeInput[^{]*\{/);
assert.match(style, /#twPromoCodeInput[^}]*color:\s*#0f172a/i);
assert.match(style, /#promoCodeInput[^}]*color:\s*#0f172a/i);
assert.match(style, /#twPromoCodeInput[^}]*border[^}]*#22d3ee/i);
assert.match(style, /#promoCodeInput[^}]*border[^}]*#22d3ee/i);
assert.match(style, /:-webkit-autofill/);
assert.match(indexHtml, /<input[^>]+type="email"[^>]+id="twEmail"/);
assert.match(indexHtml, /<input[^>]+type="email"[^>]+id="checkoutEmail"/);

// BUG 3: profile from the database must be loaded after auth settles and gate onboarding.
assert.match(script, /await\s+refreshCurrentUserProfile\(\)/);
assert.match(script, /auth.*settle|authStateReady|sessionReady|INITIAL_SESSION/i);
assert.match(script, /phone_verified_at/);
assert.match(otpService, /onboarding_completed/);
assert.match(script, /showPhoneOnboarding|openPhoneOnboarding/);
assert.match(script, /function getAuthenticatedCheckoutUser\(\)[\s\S]{0,240}currentUserProfileReady/);

// BUG 4: send/resend/verify preserve auth/rate/expiry and expose status-specific messages.
assert.match(userRoutes, /router\.put\("\/me\/phone"/);
assert.match(userRoutes, /router\.post\("\/me\/phone\/verify"/);
assert.match(phoneNumber, /08|62|E\.164|normalize/i);
assert.match(otpService, /429|RATE_LIMIT|expired|EXPIRED|provider/i);
assert.match(script, /resend|Kirim ulang/i);
assert.match(script, /res\.status === 401/);
assert.match(script, /res\.status === 429/);
assert.match(script, /function phoneApiErrorMessage/);
assert.match(script, /OTP_DELIVERY_FAILED/);
assert.match(otpService, /phone_verified_at/);
assert.match(otpService, /onboarding_completed/);
assert.match(otpService, /phone_normalized/);

// BUG 5: mobile portal navigation must be a readable, safe-area-aware surface.
assert.match(portalHtml, /tv-nav-link[\s\S]*Dashboard/);
assert.match(portalHtml, /tv-nav-link[\s\S]*Tingkatan Reseller/);
assert.match(portalCss, /safe-area-inset-bottom/);
assert.match(portalCss, /tv-nav-link[^}]*color:\s*(?!var\(--portal-faint\))/i);
assert.match(portalCss, /@media\s*\(max-width:\s*\d+px\)[\s\S]*tv-nav-link/);
assert.match(portalCss, /text-overflow:\s*ellipsis|white-space:\s*nowrap/);
assert.match(portalUi, /aria-expanded|tvNavSecondary/);

// Backend uses the same permissive validator and preserves local-part casing.
assert.match(read("nexshop-backend/utils/emailValidation.js"), /function normalizeEmail/);
assert.match(read("nexshop-backend/utils/emailValidation.js"), /function validateEmail/);
for (const email of ["user@gmail.com", "user.name@domain.co.id", "user+tag@gmail.com", " user@gmail.com "]) {
    assert.equal(emailValidation.validateEmail(email).valid, true, email);
    assert.equal(frontendContext.window.NexShopCheckoutHelpers.validateEmail(email).valid, true, `frontend ${email}`);
}
assert.equal(emailValidation.validateEmail("not-an-email").valid, false);
assert.equal(frontendContext.window.NexShopCheckoutHelpers.validateEmail("not-an-email").valid, false);
assert.match(authController, /validateEmail/);

console.log("sim92_checkout_email_whatsapp_portal_a11y: passed");
