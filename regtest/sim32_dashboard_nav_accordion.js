"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");

const dashboard = read("nexshop-frontend/admin/dashboard.html");
const script = read("nexshop-frontend/admin/js/dashboard.js");
const style = read("nexshop-frontend/admin/css/style.css");

assert.ok((dashboard.match(/sidebar-section-toggle/g) || []).length >= 5, "kategori sidebar harus berupa tombol toggle");
assert.match(dashboard, /data-nav-group="catalog-sales"/);
assert.match(dashboard, /data-nav-items="catalog-sales"/);
assert.match(dashboard, /aria-expanded="false"/);
assert.match(style, /sidebar-nav-group\.is-open[\s\S]*sidebar-section-items/);
assert.match(style, /transition:[^;]*(max-height|opacity)/);
assert.match(script, /setupSidebarGroups/);
assert.match(script, /openNavGroupForView/);
assert.match(script, /aria-expanded/);

console.log("sim32_dashboard_nav_accordion: passed");
