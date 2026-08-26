"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const file = fs.readFileSync(path.join(__dirname, "../nexshop-frontend/admin/js/dashboard.js"), "utf8").replace(/\r\n/g, "\n");

assert.match(file, /function confirmAdminLogout\(\)/);
assert.match(file, /Apakah Anda yakin akan logout\?/);
assert.match(file, /function logout\(\)\s*\{\s*if \(!confirmAdminLogout\(\)\) return;/);
assert.match(file, /function logoutAdminNow\(\)\s*\{\s*if \(!confirmAdminLogout\(\)\) return;/);
assert.match(file, /forceAdminLogout\("expired"\)/);

console.log("sim34_logout_confirmation: passed");
