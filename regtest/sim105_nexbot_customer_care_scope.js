"use strict";

const assert = require("assert");
const { isNexShopScope, OUT_OF_SCOPE_REPLY } = require("../nexshop-backend/utils/nexbotPolicy");

const inScope = [
    "Cara membeli produk?",
    "Gimana cara checkout?",
    "Saya belum menerima pesanan",
    "Bisa bayar pakai QRIS?",
    "Lupa password akun, bagaimana?",
    "Mau tanya harga pulsa",
    "Cara daftar reseller?"
];

const outOfScope = [
    "Siapa presiden Indonesia?",
    "Buatkan kode Python untuk scraping",
    "Resep nasi goreng",
    "Jadwal pertandingan liga Inggris",
    "Bagaimana cara membeli saham?"
];

for (const prompt of inScope) {
    assert.strictEqual(isNexShopScope(prompt), true, `customer-care prompt harus dianggap in-scope: ${prompt}`);
}
for (const prompt of outOfScope) {
    assert.strictEqual(isNexShopScope(prompt), false, `topik luar harus tetap ditolak: ${prompt}`);
}
assert(OUT_OF_SCOPE_REPLY.includes("produk") && OUT_OF_SCOPE_REPLY.includes("transaksi"), "fallback harus mengarahkan ke layanan customer care NexShop");

console.log("sim105_nexbot_customer_care_scope: PASS");
