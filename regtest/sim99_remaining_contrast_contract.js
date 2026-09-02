"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
const portal = read("nexshop-frontend/portal-reseller.css");
const docs = read("nexshop-frontend/docs-reseller.css");

assert.match(portal, /#ktpDropzone[\s\S]*?background:\s*var\(--portal-surface-blue\)/i);
assert.match(portal, /#ktpUploadPrompt\s*>\s*div:first-of-type[\s\S]*?color:\s*var\(--portal-ink\)/i);
assert.match(portal, /#ktpUploadPrompt\s*>\s*div:last-of-type[\s\S]*?color:\s*var\(--portal-muted\)/i);
assert.doesNotMatch(portal, /color:\s*var\(--portal-accent\)/i, "portal must not use an undefined accent token");

assert.match(docs, /--docs-cyan:\s*#0e7490/i);
assert.match(docs, /\.reseller-docs-page\s+\.docs-endpoint-url[\s\S]*?color:\s*var\(--docs-ink\)/i);
assert.match(docs, /\.reseller-docs-page\s+\.docs-http-method--get[\s\S]*?color:\s*#087f69/i);
assert.match(docs, /\.reseller-docs-page\s+\.docs-http-method--post[\s\S]*?color:\s*#0647a0/i);
assert.match(docs, /\.reseller-docs-page\s+\.docs-code-content\s+\.comment[\s\S]*?color:\s*#9ca3af/i);
assert.match(docs, /\.reseller-docs-page\s+\.mkt-nav-links[\s\S]*?background:\s*var\(--docs-surface\)/i);
assert.match(docs, /\.reseller-docs-page\s+\.docs-cta-actions\s+\.mkt-btn-secondary[\s\S]*?color:\s*var\(--docs-blue-dark\)/i);

console.log("sim99_remaining_contrast_contract: passed");
