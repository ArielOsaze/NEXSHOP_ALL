const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const indexHtml = read('nexshop-frontend/index.html');
const styleCss = read('nexshop-frontend/style.css');
const resellerCss = read('nexshop-frontend/reseller.css');
const portalHtml = read('nexshop-frontend/portal-reseller.html');
const portalCss = read('nexshop-frontend/portal-reseller.css');
const portalUiJs = read('nexshop-frontend/portal-reseller-ui.js');
const storefrontJs = read('nexshop-frontend/script.js');
const authController = read('nexshop-backend/controllers/authController.js');
const resellerPricing = read('nexshop-backend/utils/resellerPricing.js');
const resellerController = read('nexshop-backend/controllers/resellerController.js');
const authRoutes = read('nexshop-backend/routes/authRoutes.js');
const rateLimiter = read('nexshop-backend/middleware/rateLimiter.js');

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

assert(/class="[^"]*nx-account-nav-btn[^>]*"[^>]*id="accountBtn"/.test(indexHtml), 'account control must have an explicit mobile-safe class');
assert(/#mainNav\s+#?accountBtn|#mainNav\s+\.nx-account-nav-btn/.test(styleCss), 'account control must have scoped navbar styling');
assert(/#mainNav\s+#accountBtn[\s\S]*?display:\s*flex/.test(styleCss), 'account avatar must remain visible on mobile');
assert(/rs-tier-card::after[\s\S]*?display:\s*none/.test(resellerCss), 'tier card hover outline pseudo-element must be disabled');
assert(/rs-step:not\(:last-child\)::after/.test(resellerCss), 'step connectors must be segmented instead of one crossing line');
assert(/tv-tier-platinum[\s\S]*?#e5e4e2|#e5e4e2[\s\S]*?tv-tier-platinum/.test(portalCss), 'portal platinum palette must use the referenced platinum neutral');
assert(/tv-tier-gold[\s\S]*?#d4af37|#d4af37[\s\S]*?tv-tier-gold/.test(portalHtml + portalCss), 'portal gold palette must use metallic gold accent');
assert(/tv-tier-platinum[\s\S]*?#a7b0bb|#a7b0bb[\s\S]*?tv-tier-platinum/.test(portalHtml + portalCss), 'portal platinum palette must use a cool platinum accent');
assert(/const pageSize = 100/.test(portalHtml), 'portal catalog must render a smaller first page progressively');
assert(/Hemat Rp|harga hemat|effectiveDiscount|harga_normal/.test(portalHtml), 'portal product cards must show an explicit price comparison detail');
assert(/PORTAL_CATALOG_CACHE_TTL_MS|portalCatalogCache|getCachedPortalCatalogRows/.test(resellerController), 'portal catalog rows must be cached between repeated page requests');
assert(/MIN_MARGIN_PERSEN\s*=\s*1(?:\.0)?/.test(resellerPricing), 'reseller floor margin must be slightly thinner');
assert(/adminLoginLimiter/.test(rateLimiter) && /adminLoginLimiter/.test(authRoutes), 'admin login must have a dedicated anti-spam limiter');
assert(/Tanyakan seputar produk, transaksi, akun, atau layanan/.test(indexHtml), 'NexBot UI must describe customer-care scope');
assert(/normalizeGooglePicture/.test(authController) && /if \(!linkedUser\.avatar_url && googlePicture\)/.test(authController), 'Google photo must fill only an empty avatar slot');
assert(/if \(!localUser\.avatar_url && googlePicture\) profileUpdate\.avatar_url/.test(authController), 'Google link must not overwrite an uploaded avatar');
assert(/avatar_url: googlePicture/.test(authController), 'new Google accounts must receive the provider photo');
assert(/avatar_url/.test(storefrontJs) && /google/i.test(storefrontJs), 'existing avatar upload/Google profile data contract must remain present');
assert(/#mainNav\s+#accountBtnAvatar\.is-empty[\s\S]*?background/.test(styleCss), 'guest avatar must have a visible template surface');
assert(/#mainNav\s+#accountBtnAvatar\.is-empty::before[\s\S]*?border-radius/.test(styleCss) && /#mainNav\s+#accountBtnAvatar\.is-empty::after[\s\S]*?border-radius/.test(styleCss), 'guest avatar template must render head and shoulders');
assert(/#mainNav\s+#accountBtnLabel\s*\{[\s\S]*?display:\s*none\s*!important/.test(styleCss), 'account label must be hidden while avatar remains visible');
assert(/: ''/.test(storefrontJs) || /: ""/.test(storefrontJs), 'guest account avatar fallback must be empty');

console.log('sim104_reseller_auth_catalog_ux_contract: PASS');
