"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8").replace(/\r\n/g, "\n");
const portal = read("nexshop-frontend/portal-reseller.html");
const portalCssPath = path.join(root, "nexshop-frontend/portal-reseller.css");
const portalJsPath = path.join(root, "nexshop-frontend/portal-reseller-ui.js");

function check(label, condition) {
    assert.ok(condition, label);
}

check("portal memuat stylesheet visual khusus", /portal-reseller\.css\?v=20260903-portal-catalog-tier-5/.test(portal));
check("portal memakai scope light reseller", /class="[^"]*rs-portal-page/.test(portal));
check("portal memiliki app topbar", /class="tv-portal-topbar"/.test(portal));
check("portal topbar memiliki judul dinamis", /id="tvPageTitle"/.test(portal));
check("sidebar memiliki label aksesibel", /<nav[^>]+aria-label="Partner Portal"/.test(portal));
check("portal memiliki scrim mobile", /class="tv-sidebar-scrim"/.test(portal));
check("stylesheet portal memakai token landing", /--rs-ink:\s*#101828/.test(read("nexshop-frontend/portal-reseller.css")));
check("stylesheet portal memakai surface landing", /--rs-surface:\s*#ffffff/.test(read("nexshop-frontend/portal-reseller.css")));
check("stylesheet portal memiliki reduced motion", /prefers-reduced-motion:\s*reduce/.test(read("nexshop-frontend/portal-reseller.css")));
check("stylesheet portal memiliki drawer transition", /tv-sidebar-scrim|tv-sidebar\.open/.test(read("nexshop-frontend/portal-reseller.css")));
check("portal UI helper terpisah dari business controller", fs.existsSync(portalJsPath));
check("portal UI helper tidak memanggil API reseller", !/fetch\(|XMLHttpRequest|localStorage|sessionStorage/.test(read("nexshop-frontend/portal-reseller-ui.js")));
check("portal tetap mempertahankan auth context reseller", /nexshop-reseller-token/.test(portal) && /reseller\/auth\/login/.test(portal));
check("portal tetap mempertahankan route 2FA", /reseller\/auth\/2fa\/verify/.test(portal) && /portal\/2fa\/status/.test(portal));
check("portal tetap mempertahankan route API settings", /portal\/settings/.test(portal) && /portal\/test-webhook/.test(portal));
check("portal tetap memiliki delapan view operasional", ["dashboard", "products", "deposit", "mutations", "transactions", "settings", "api", "tiers"].every((view) => portal.includes(`id="view-${view}"`)));
check("portal tidak memuat Tailwind CDN baru", !portal.includes("cdn.tailwindcss.com"));

console.log("PASS sim71: reseller portal visual system contract (17 checks).");
