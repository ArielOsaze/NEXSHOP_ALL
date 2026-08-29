"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8").replace(/\r\n/g, "\n");

const docs = read("nexshop-frontend/docs-reseller.html");
const docsCssPath = path.join(root, "nexshop-frontend/docs-reseller.css");
const portalCss = read("nexshop-frontend/portal-reseller.css");
const script = read("nexshop-frontend/script.js");
const index = read("nexshop-frontend/index.html");
const headers = read("nexshop-frontend/_headers");
const nginx = read("nginx-nexshop.conf");

assert.ok(fs.existsSync(docsCssPath), "docs reseller scoped stylesheet exists");
assert.match(docs, /docs-reseller\.css/);
assert.strictEqual((docs.match(/<head\b/gi) || []).length, 1, "docs has one head element");
assert.strictEqual((docs.match(/<\/head>/gi) || []).length, 1, "docs head is closed");
assert.strictEqual((docs.match(/<body\b/gi) || []).length, 1, "docs has one body element");
assert.match(docsCssPath ? read("nexshop-frontend/docs-reseller.css") : "", /reseller-docs-page/);
assert.doesNotMatch(portalCss, /--portal-faint:\s*#98a2b3/i);
assert.match(portalCss, /placeholder[\s\S]*color:\s*var\(--portal-muted\)/i);
assert.match(script, /function renderLeaderboard/);
assert.match(script, /hof-avatar-fallback/);
assert.match(script, /fallback-remove/);
assert.match(headers, /https:\/\/i\.pinimg\.com/);
assert.match(headers, /https:\/\/img3\.tapimg\.net/);
assert.match(nginx, /https:\/\/i\.pinimg\.com/);
assert.match(nginx, /https:\/\/img3\.tapimg\.net/);
assert.match(index, /id="leaderboardContent"/);

console.log("PASS sim76: docs theme, portal readability, dan Hall of Fame image contract.");
