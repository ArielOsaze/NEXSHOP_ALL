const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8").replace(/\r\n/g, "\n");
const reseller = read("nexshop-frontend/reseller.html");
const resellerCss = read("nexshop-frontend/reseller.css");
const homepageJs = read("nexshop-frontend/script.js");
const homepageCss = read("nexshop-frontend/style.css");

function assert(ok, message) {
    if (!ok) throw new Error(message);
}

// Rank 2 must be a visible silver/titanium treatment, not blue or indigo.
const rank2Css = homepageCss.match(/\.hof-podium-card--2\s*\{[\s\S]*?\n\}/)?.[0] || "";
assert(rank2Css, "Hall of Fame rank 2 frame style missing");
assert(/94a3b8|cbd5e1|e2e8f0|slate|silver|titanium/i.test(rank2Css), "Hall of Fame rank 2 must use a silver/titanium frame palette");
assert(!/2563eb|1d4ed8|4f46e5|6366f1|sapphire|indigo/i.test(rank2Css), "Hall of Fame rank 2 must not use a blue/indigo frame palette");
assert(/hof-avatar\.hof-avatar--2[\s\S]*?(94a3b8|cbd5e1|e2e8f0|slate|silver|titanium)/i.test(homepageCss), "Hall of Fame rank 2 avatar must retain a visible titanium frame");
assert(/from-slate|to-slate|rgba\(100,116,139/i.test(homepageJs), "Hall of Fame rank 2 avatar/badge must use a titanium runtime palette");

// Reseller landing must be full-bleed while preserving a readable inner rhythm.
assert(/\.rs-hero\s*\{[\s\S]*?width\s*:\s*100%[\s\S]*?max-width\s*:\s*none[\s\S]*?padding(?:-inline)?/i.test(resellerCss), "Reseller hero must be full-bleed with responsive inline padding");
assert(/\.rs-hero-float-top\s*\{[\s\S]*?left\s*:\s*0(?:px)?/i.test(resellerCss), "Top hero float must stay inside the viewport on mobile");
assert(/\.rs-hero-float-bottom\s*\{[\s\S]*?right\s*:\s*0(?:px)?/i.test(resellerCss), "Bottom hero float must stay inside the viewport on mobile");
assert(/\.rs-hero-visual\s*\{[\s\S]*?min-width\s*:\s*0/i.test(resellerCss), "Hero visual must be shrink-safe at narrow widths");

// Replace generic lightning/AI-slop icon with established professional iconography.
assert(!/fa-bolt|fa-lightning/i.test(reseller), "reseller landing must not use lightning icons");
assert(/fa-shield-halved|fa-chart-line|fa-link|fa-headset|fa-receipt/i.test(reseller), "reseller landing must use professional SaaS/B2B iconography");

// Typography must remain legible and deliberate across viewport sizes.
assert(/\.rs-hero h1\s*\{[\s\S]*?font-size\s*:\s*clamp\([\s\S]*?line-height\s*:\s*1\.0[\s\S]*?\}/i.test(resellerCss), "Reseller headline needs responsive typographic hierarchy");
assert(/\.rs-hero-lead\s*\{[\s\S]*?font-size\s*:\s*clamp\([\s\S]*?line-height\s*:\s*1\.7/i.test(resellerCss), "Reseller lead copy needs readable responsive typography");

console.log("PASS sim85: reseller rank-2 frame, full-bleed responsive layout, professional icons, and typography");
