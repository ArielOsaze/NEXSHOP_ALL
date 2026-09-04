"use strict";

const assert = require("assert");
const fs = require("fs");

const css = fs.readFileSync("nexshop-frontend/style.css", "utf8");
const mobile = css.match(/@media\s*\(max-width:\s*767px\)[\s\S]*?(?=\n@media\b|\n\/\*|\n\.topup-route-status)/i)?.[0] || "";

assert(mobile, "Blok responsive topup mobile harus tersedia");
assert(
    /#topup\s+\.topup-game-grid\s*\{[\s\S]*?grid-template-columns\s*:\s*repeat\(1\s*,\s*minmax\(0\s*,\s*1fr\)\)/i.test(mobile),
    "RED: grid topup mobile harus satu kolom agar kartu tidak terpecah menjadi dua kolom"
);
console.log("sim109_topup_mobile_single_column: PASS");
