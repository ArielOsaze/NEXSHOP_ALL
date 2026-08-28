"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const style = fs.readFileSync(path.join(root, "nexshop-frontend/admin/css/style.css"), "utf8").replace(/\r\n/g, "\n");
const html = fs.readFileSync(path.join(root, "nexshop-frontend/admin/dashboard.html"), "utf8").replace(/\r\n/g, "\n");

assert.match(style, /\.app-shell\s*>\s*main\s*\{[\s\S]*flex:\s*1 1 auto[\s\S]*min-width:\s*0/);
assert.match(style, /\.app-shell > main\s*\{[^}]*min-width:0;[^}]*width:calc\(100% - 260px\);[^}]*margin-left:260px;[^}]*\}/s);
assert.match(style, /@media\s*\(max-width\s*:\s*991px\)[\s\S]*?\.app-shell\s*>\s*main\s*\{[^}]*margin-left\s*:\s*0/s);
assert.match(html, /css\/style\.css\?v=20260828-approval-layout-2/);
assert.match(html, /id="view-approvals" class="view-section d-none"/);
const mainStart = html.indexOf("<main ");
const mainEnd = html.indexOf("</main>");
const approvalsStart = html.indexOf("<section id=\"view-approvals\"");
assert.ok(approvalsStart > mainStart && approvalsStart < mainEnd,
    "approval view must stay inside the layout main container");
assert.ok(!style.includes("#view-approvals{position:"), "approval tidak boleh memakai posisi overlay absolut/fixed");

console.log("sim33_approval_layout_no_sidebar_overlap: passed");
