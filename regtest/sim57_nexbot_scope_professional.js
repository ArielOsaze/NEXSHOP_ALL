"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const backend = path.join(root, "nexshop-backend");
const controllerPath = path.join(backend, "controllers", "aiController.js");
const controllerSource = fs.readFileSync(controllerPath, "utf8");
const docs = fs.readFileSync(path.join(root, "nexshop-frontend", "docs-reseller.html"), "utf8");
const { normalizeQuery, detectIntent, detectEntities, rankKnowledge } = require(path.join(backend, "utils", "nexbotEngine"));

const blockStart = controllerSource.indexOf("const BUILTIN_KNOWLEDGE = [");
const blockEnd = controllerSource.indexOf("\n];", blockStart);
assert.ok(blockStart >= 0 && blockEnd > blockStart, "builtin knowledge harus dapat diaudit");
// eslint-disable-next-line no-eval
const BUILTIN_KNOWLEDGE = eval(controllerSource.slice(blockStart + "const BUILTIN_KNOWLEDGE = ".length, blockEnd + 2));

function selectedIds(question) {
    const query = normalizeQuery(question);
    const intent = detectIntent(query);
    const entities = detectEntities(query);
    return rankKnowledge(BUILTIN_KNOWLEDGE, query, intent, entities).map((item) => item.id);
}

const retrievalCases = [
    ["apakah harus punya akun belanja dulu untuk daftar reseller?", "builtin-reseller-onboarding"],
    ["kenapa email akun utama tidak bisa dipakai di partner portal?", "builtin-reseller-onboarding"],
    ["data apa saja yang wajib untuk daftar reseller NexShop?", "builtin-reseller-onboarding"],
    ["setelah kirim KYC apa langsung bisa transaksi?", "builtin-reseller-approval"],
    ["berapa lama verifikasi KYC reseller?", "builtin-reseller-approval"],
    ["cara cek status pendaftaran reseller", "builtin-reseller-approval"],
    ["cara aktifkan 2FA portal reseller", "builtin-reseller-security"],
    ["recovery code portal bisa dipakai berapa kali?", "builtin-reseller-security"],
    ["kapan API Key reseller tersedia?", "builtin-reseller-api"],
    ["boleh taruh Secret Key NexShop di javascript browser?", "builtin-reseller-api"]
];
for (const [question, expected] of retrievalCases) {
    const ids = selectedIds(question);
    assert.ok(ids.includes(expected), `${question} harus memilih ${expected}; aktual: ${ids.join(", ") || "KOSONG"}`);
}

const policyPath = path.join(backend, "utils", "nexbotPolicy.js");
assert.ok(fs.existsSync(policyPath), "scope guard dan formatter NexBot harus tersedia sebagai modul teruji");
const { isNexShopScope, formatProfessionalReply, OUT_OF_SCOPE_REPLY } = require(policyPath);

for (const question of [
    "bagaimana cara daftar reseller NexShop?",
    "cara bayar pakai QRIS",
    "topup Mobile Legends bisa?",
    "cara cek status pesanan",
    "apa itu NexShop Wallet?",
    "cara aktifkan 2FA partner portal"
]) {
    assert.strictEqual(isNexShopScope(question), true, `pertanyaan NexShop harus in-scope: ${question}`);
}
for (const question of [
    "siapa presiden Amerika sekarang?",
    "buatkan kode Python untuk scraping",
    "NexShop, buatkan kode Python untuk scraping",
    "resep nasi goreng yang enak",
    "NexShop punya resep nasi goreng?",
    "cuaca Jakarta besok bagaimana?",
    "hasil pertandingan sepak bola tadi malam",
    "diagnosis sakit kepala saya"
]) {
    assert.strictEqual(isNexShopScope(question), false, `pertanyaan luar NexShop harus ditolak: ${question}`);
}
assert.match(OUT_OF_SCOPE_REPLY, /hanya dapat membantu.*NexShop/i);
assert.doesNotMatch(OUT_OF_SCOPE_REPLY, /knowledge|RAG|database|retrieval/i);

const messy = "### Jawaban\n\n📦 • Langkah satu   \n• Langkah dua\n\n\n\n**Catatan:** selesai";
const polished = formatProfessionalReply(messy);
assert.doesNotMatch(polished, /^#{1,6}\s/m, "heading markdown tidak boleh lolos");
assert.doesNotMatch(polished, /[📦•]/u, "emoji dekoratif dan bullet campuran harus dinormalisasi");
assert.doesNotMatch(polished, /\n{3,}/, "jarak antarblok tidak boleh berantakan");
assert.match(polished, /- Langkah satu\n- Langkah dua/);

assert.match(controllerSource, /isNexShopScope\(/, "controller harus menegakkan scope sebelum memanggil provider AI");
assert.match(controllerSource, /formatProfessionalReply\(reply\)/, "semua jalur jawaban harus melewati formatter profesional");
assert.match(controllerSource, /source\s*=\s*["']out_of_scope["']/, "jawaban di luar NexShop harus memiliki source terpisah");

for (const marker of [
    "akun portal benar-benar terpisah",
    "Cek Status Verifikasi Terkini",
    "2FA opsional",
    "recovery code"
]) {
    assert.ok(docs.toLowerCase().includes(marker.toLowerCase()), `docs dan RAG membutuhkan marker: ${marker}`);
    assert.ok(controllerSource.toLowerCase().includes(marker.toLowerCase()), `knowledge RAG harus tersinkron dengan docs: ${marker}`);
}

console.log("PASS sim57: NexBot menjawab cakupan NexShop, menolak luar domain, dan merapikan output");
