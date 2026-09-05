"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const css = fs.readFileSync(path.join(root, "nexshop-frontend", "portal-reseller.css"), "utf8");
const html = fs.readFileSync(path.join(root, "nexshop-frontend", "portal-reseller.html"), "utf8");

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

assert(/#tvTierGrid[\s\S]{0,300}grid-template-columns: minmax\(0, 1fr\)/.test(css), "tier grid must collapse to one column on mobile");
assert(/tv-portal-tier-card[\s\S]{0,600}background: linear-gradient\(160deg, #263449 0%, var\(--portal-surface-soft\) 76%\)/.test(css), "silver tier must have a dark surface");
assert(/tv-portal-tier-card\.tv-tier-gold[\s\S]{0,700}background: linear-gradient\(160deg, #3a301a 0%, var\(--portal-surface-soft\) 76%\)/.test(css), "gold tier must have a dark surface");
assert(/tv-portal-tier-card\.tv-tier-platinum[\s\S]{0,700}background: linear-gradient\(160deg, #2d3748 0%, var\(--portal-surface-soft\) 76%\)/.test(css), "platinum tier must have a dark surface");
assert(/tv-purchase-dialog[\s\S]{0,500}background: var\(--portal-surface\) !important/.test(css), "purchase dialog must use a dark surface");
assert(/tv-purchase-dialog input[\s\S]{0,450}background: var\(--portal-surface-soft\) !important/.test(css), "purchase inputs must use dark surfaces");
assert(/tv-purchase-footer[\s\S]{0,500}flex-direction: column/.test(css), "purchase footer must stack on narrow mobile");
assert(/tv-sidebar[\s\S]{0,700}transform: translateX\(-105%\) !important/.test(css), "mobile sidebar must be a closed drawer");
assert(/tv-mobile-menu-button[\s\S]{0,400}display: inline-grid !important/.test(css), "mobile menu button must be visible");
assert(/#view-api > \[data-csp-style="s56aff50eaf4b65"\][\s\S]{0,500}grid-template-columns: minmax\(0, 1fr\) !important/.test(css), "API view wrapper must be one column on mobile");
assert(/#sectionDashboard input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\)[\s\S]{0,300}background: var\(--portal-surface-soft\) !important/.test(css), "dashboard text inputs must use dark surfaces");
assert(/#sectionDashboard\.portal-drawer-open \.tv-sidebar-scrim[\s\S]{0,300}background: rgba\(2, 6, 23, \.68\) !important/.test(css), "drawer scrim must be dark");
assert(html.includes('id="view-tiers"'), "tier view must remain present");
assert(html.includes('id="portalPurchaseOverlay"'), "purchase overlay must remain present");
assert(html.includes('id="view-deposit"'), "deposit view must remain present");
assert(html.includes('id="view-api"'), "API view must remain present");

console.log("PASS sim111_portal_mobile_dark_views: drawer, responsive views, tiers, deposit payment modal");
