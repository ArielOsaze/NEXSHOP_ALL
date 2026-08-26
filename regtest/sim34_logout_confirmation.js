"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const adminFile = fs.readFileSync(path.join(__dirname, "../nexshop-frontend/admin/js/dashboard.js"), "utf8").replace(/\r\n/g, "\n");
const publicFile = fs.readFileSync(path.join(__dirname, "../nexshop-frontend/script.js"), "utf8").replace(/\r\n/g, "\n");

assert.match(adminFile, /function confirmAdminLogout\(\)/);
assert.match(adminFile, /Apakah Anda yakin akan logout\?/);
assert.match(adminFile, /function logout\(\)\s*\{\s*if \(!confirmAdminLogout\(\)\) return;/);
assert.match(adminFile, /function logoutAdminNow\(\)\s*\{\s*if \(!confirmAdminLogout\(\)\) return;/);
assert.match(adminFile, /forceAdminLogout\("expired"\)/);
assert.match(publicFile, /document\.getElementById\("logoutBtn"\)\.addEventListener\("click", \(\) => \{\s*if \(!window\.confirm\("Apakah Anda yakin akan logout\?"\)\) return;/);

console.log("sim34_logout_confirmation: passed");
