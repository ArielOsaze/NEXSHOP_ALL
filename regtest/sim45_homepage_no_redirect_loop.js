"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const nginx = fs.readFileSync(path.join(root, "nginx-nexshop.conf"), "utf8").replace(/\r\n/g, "\n");

const exactRootServesIndex = /location\s*=\s*\/\s*\{\s*(?:expires\s+-1;\s*)?try_files\s+\/index\.html\s+=404;\s*\}/s.test(nginx);
const legacyIndexRedirectsToRoot = /location\s*=\s*\/index\.html\s*\{\s*return\s+301\s+\/;\s*\}/s.test(nginx);
const genericRouteCanStillServeFiles = /location\s+\/\s*\{\s*try_files\s+\$uri\s+\$uri\/\s+=404;\s*\}/s.test(nginx);

if (!exactRootServesIndex) {
    throw new Error("Homepage / must serve /index.html directly before the generic directory route; otherwise / -> /index.html -> / loops.");
}
if (!legacyIndexRedirectsToRoot) {
    throw new Error("Legacy /index.html canonical redirect to / must remain enabled.");
}
if (!genericRouteCanStillServeFiles) {
    throw new Error("Generic static route contract unexpectedly changed.");
}

console.log("sim45_homepage_no_redirect_loop: PASS");
