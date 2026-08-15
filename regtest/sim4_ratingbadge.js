// Regression test: logic pemilihan badge rating di daftar "Riwayat Saya"
function pickBadge(t) {
    const isPaid = t.status === "paid" || t.status === "sukses";
    if (t.type === "order" && isPaid && t.has_rating === false) return "needed";
    if (t.type === "order" && isPaid && t.has_rating === true) return "done";
    return "none";
}

const cases = [
    { name: "order paid, belum rating", input: { type: "order", status: "paid", has_rating: false }, expect: "needed" },
    { name: "order paid, sudah rating", input: { type: "order", status: "paid", has_rating: true }, expect: "done" },
    { name: "order pending", input: { type: "order", status: "pending", has_rating: null }, expect: "none" },
    { name: "order failed", input: { type: "order", status: "failed", has_rating: null }, expect: "none" },
    { name: "topup sukses (topup gak boleh dpt badge rating)", input: { type: "topup", status: "sukses", has_rating: null }, expect: "none" },
    { name: "topup pending", input: { type: "topup", status: "pending", has_rating: null }, expect: "none" },
];

let allPass = true;
for (const c of cases) {
    const got = pickBadge(c.input);
    const ok = got === c.expect;
    if (!ok) allPass = false;
    console.log(`${ok ? "PASS" : "FAIL"} — ${c.name}: expected "${c.expect}", got "${got}"`);
}
process.exit(allPass ? 0 : 1);
