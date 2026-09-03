"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const html = read("nexshop-frontend/reseller.html");
const css = read("nexshop-frontend/reseller.css");
const resellerJs = read("nexshop-frontend/reseller.js");
const index = read("nexshop-frontend/index.html");
const script = read("nexshop-frontend/script.js");
const auth = read("nexshop-backend/controllers/authController.js");

const assert = (condition, message) => {
    if (!condition) throw new Error(message);
};

["rs-network-flow-svg", "rs-wallet-flow-svg", "rs-api-flow-svg", "rs-universe-flow-svg"].forEach((name) => {
    assert(html.includes(name), `missing SVG flow host: ${name}`);
});
assert(resellerJs.includes("getBoundingClientRect"), "flow endpoints must use live node geometry");
assert(resellerJs.includes("createElementNS(\"http://www.w3.org/2000/svg\", \"path\")"), "flow paths must be explicit SVG paths");
assert(resellerJs.includes("ResizeObserver"), "flow paths must recalculate on responsive resize");
assert(resellerJs.includes("const mobileMode = () => window.matchMedia(\"(max-width: 680px)\")"), "mobile dominant-card mode missing");
assert(resellerJs.includes("const distance = Math.abs((rect.top + rect.bottom) / 2 - centerY)"), "mobile dominant-card selection missing");
assert(css.includes(".rs-page .rs-api-route-line"), "legacy API line contract missing");
assert(css.includes("display: none !important"), "legacy pixel/rotate connection visuals must be disabled");
assert(css.includes("@keyframes rs-flow-glow"), "valid SVG path glow animation missing");
assert(css.includes("@media (max-width: 680px)"), "mobile flow breakpoint missing");
assert(css.includes(".rs-page .rs-universe-stage") && css.includes("overflow: hidden"), "universe flow must stay clipped inside its card");
assert(!/rs-api-pulse[\s\S]*translateX\(\d+px\)/.test(css), "fixed-pixel API particle animation remains");
assert(index.includes('id="accountBtnAvatar"') && index.includes("is-empty"), "guest avatar template state missing");
assert(script.includes("target.classList.toggle(\"is-empty\", !user)"), "guest avatar state is not rendered explicitly");
assert(script.includes("target.classList.remove(\"is-empty\")"), "authenticated avatar does not replace guest template");
assert(script.includes("/users/me/avatar") && script.includes("avatar_url: uploadData.url"), "uploaded avatar is not persisted/rendered");
assert(auth.includes("normalizeGooglePicture") && auth.includes("avatar_url: googlePicture"), "Google avatar fallback is not persisted");
assert(auth.includes("if (!linkedUser.avatar_url && googlePicture)"), "Google login would overwrite an uploaded avatar");

console.log("sim108_reseller_connection_flow_contract: PASS");
