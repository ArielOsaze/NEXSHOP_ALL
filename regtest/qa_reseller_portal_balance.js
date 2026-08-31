"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(
    path.join(__dirname, "..", "nexshop-backend", "controllers", "resellerController.js"),
    "utf8"
);

try {
    assert.match(source, /from\("wallets"\)/, "overview harus membaca wallet yang dipakai checkout");
    assert.match(source, /select\("balance"\)/, "overview harus mengambil kolom balance");
    assert.doesNotMatch(source, /Number\(user\.balance\)/, "overview tidak boleh memakai balance usang dari users");
    console.log("PASS qa_reseller_portal_balance: overview membaca saldo wallet aktual");
} catch (error) {
    console.error(`FAIL qa_reseller_portal_balance: ${error.message}`);
    process.exitCode = 1;
}
