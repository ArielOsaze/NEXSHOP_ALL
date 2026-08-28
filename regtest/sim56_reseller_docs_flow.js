"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const docs = fs.readFileSync(path.join(root, "nexshop-frontend/docs-reseller.html"), "utf8");
const start = docs.indexOf("<!-- ── Bab 3: Cara Daftar ── -->");
const end = docs.indexOf("<!-- ── Bab 4: Mekanisme Harga & Tier ── -->", start);
assert.ok(start >= 0 && end > start, "Bab 3 harus memiliki batas section yang stabil");
const chapter = docs.slice(start, end);

assert.doesNotMatch(chapter, /Miliki Akun NexShop|sudah mendaftar dan memiliki akun pengguna|\/login\b/i,
    "Bab 3 tidak boleh menyuruh calon reseller membuat/login akun storefront");
assert.match(chapter, /portal-reseller\?mode=register/i,
    "Bab 3 harus mengarahkan langsung ke tab pendaftaran Portal Reseller");
assert.match(chapter, /akun (?:belanja|storefront).*tidak.*(?:dipakai|berlaku|otomatis)|terpisah dari akun belanja/is,
    "Bab 3 harus menjelaskan identity portal terpisah");
assert.match(chapter, /email.*belum pernah dipakai.*NexShop|email.*berbeda.*akun belanja/is,
    "Bab 3 harus menjelaskan email portal harus khusus dan belum dipakai akun belanja");
assert.match(chapter, /Nama Lengkap.*WhatsApp.*NIK.*Foto KTP/is,
    "Bab 3 harus mencantumkan data wajib form KYC secara lengkap");
assert.match(chapter, /verifikasi keamanan|Turnstile|bukan robot/i,
    "Bab 3 harus menjelaskan verifikasi keamanan sebelum submit");
assert.match(chapter, /pending|menunggu verifikasi/i,
    "Bab 3 harus menjelaskan status awal setelah formulir terkirim");
assert.match(chapter, /3(?:&times;|×|x)24 jam kerja/i,
    "Bab 3 harus menyebut SLA review maksimal 3x24 jam kerja");
assert.match(chapter, /Cek Status Verifikasi Terkini/i,
    "Bab 3 harus menjelaskan cara memantau status tanpa membuat akun ulang");
assert.match(chapter, /belum dapat.*(?:transaksi|API)|transaksi.*baru.*approved|setelah.*disetujui/is,
    "Bab 3 tidak boleh menyesatkan akun pending seolah sudah bisa transaksi/API");
assert.match(chapter, /API Key.*Secret Key/is,
    "Bab 3 harus menjelaskan akses integrasi setelah approval");
assert.match(chapter, /2FA.*opsional|opsional.*2FA/is,
    "Bab 3 harus menjelaskan 2FA authenticator bersifat opsional");
assert.match(chapter, /recovery code/i,
    "Bab 3 harus mengingatkan penyimpanan recovery code 2FA");

console.log("PASS sim56: Bab 3 reseller lengkap, akurat, dan tidak mencampur akun storefront");
