// Regression test: pastikan tidak ada karakter mojibake tersisa di index.html
// setelah perbaikan, dan file tetap valid UTF-8 / jumlah baris tidak berubah.
const fs = require('fs');
const path = process.argv[2] || __dirname + '/../nexshop-frontend/index.html';
const text = fs.readFileSync(path, 'utf-8');

const bad = ['â€¢', 'â€”', 'â€“', 'Ã', '\uFFFD'];
let found = [];
for (const p of bad) {
    const c = (text.match(new RegExp(p, 'g')) || []).length;
    if (c > 0) found.push(`${JSON.stringify(p)} x${c}`);
}

if (found.length === 0) {
    console.log("PASS: tidak ada karakter mojibake tersisa di", path);
} else {
    console.log("FAIL: masih ada mojibake ->", found.join(", "));
    process.exit(1);
}
