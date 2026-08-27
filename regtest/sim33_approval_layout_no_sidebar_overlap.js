"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const style = fs.readFileSync(path.join(root, "nexshop-frontend/admin/css/style.css"), "utf8").replace(/\r\n/g, "\n");
const html = fs.readFileSync(path.join(root, "nexshop-frontend/admin/dashboard.html"), "utf8").replace(/\r\n/g, "\n");

assert.match(style, /\.app-shell\s*>\s*main\s*\{[\s\S]*flex:\s*1 1 auto[\s\S]*min-width:\s*0/);
assert.match(style, /\.app-shell\s*>\s*main\s*\{[\s\S]*margin-left:\s*0/);
assert.match(html, /css\/style\.css\?v=20260827-brand-motion-1/);
assert.match(html, /id="view-approvals" class="view-section d-none"/);
assert.ok(!style.includes("#view-approvals{position:"), "approval tidak boleh memakai posisi overlay absolut/fixed");

console.log("sim33_approval_layout_no_sidebar_overlap: passed");
