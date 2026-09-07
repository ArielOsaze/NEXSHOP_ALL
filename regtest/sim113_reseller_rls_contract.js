"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const migrationPath = path.join(__dirname, "..", "nexshop-backend", "migrations", "025_harden_reseller_wallet_rls.sql");
const sql = fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, "utf8") : "";
const tables = [
    "reseller_api_keys",
    "reseller_portal_accounts",
    "reseller_portal_2fa",
    "reseller_applications",
    "reseller_tiers",
    "wallets",
    "wallet_transactions",
    "wallet_topups",
    "webhook_endpoints",
    "webhook_deliveries"
];

for (const table of tables) {
    assert.match(sql, new RegExp(`ALTER TABLE(?:\\s+IF EXISTS)?\\s+public\\.${table}\\s+ENABLE ROW LEVEL SECURITY`, "i"), `${table} wajib mengaktifkan RLS`);
    assert.match(sql, new RegExp(`REVOKE ALL ON TABLE public\\.${table} FROM anon, authenticated`, "i"), `${table} tidak boleh terbuka untuk anon/authenticated`);
}

assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.credit_wallet_atomic\([^;]+\) FROM PUBLIC, anon, authenticated/i, "RPC credit wallet wajib ditutup dari PUBLIC dan role API");
assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.debit_wallet_atomic\([^;]+\) FROM PUBLIC, anon, authenticated/i, "RPC debit wallet wajib ditutup dari PUBLIC dan role API");
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.credit_wallet_atomic\([^;]+TO service_role/i, "service_role tetap boleh memakai RPC credit");
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.debit_wallet_atomic\([^;]+TO service_role/i, "service_role tetap boleh memakai RPC debit");

console.log("PASS sim113_reseller_rls_contract");
