// Regression test: logic penambahan has_rating di getMyOrders (backend)
function attachHasRating(orders, ratedIds) {
    const paidOrderIds = orders.filter(o => o.status === "paid").map(o => o.id);
    const ratedSet = new Set(ratedIds.filter(id => paidOrderIds.includes(id)));
    return orders.map(o => ({
        ...o,
        has_rating: o.status === "paid" ? ratedSet.has(o.id) : null
    }));
}

const orders = [
    { id: "ORD1", status: "paid" },
    { id: "ORD2", status: "paid" },
    { id: "ORD3", status: "pending" },
    { id: "ORD4", status: "failed" },
];
const ratedIds = ["ORD1"]; // cuma ORD1 yang sudah dirating

const result = attachHasRating(orders, ratedIds);
console.log(JSON.stringify(result, null, 2));

const expected = { ORD1: true, ORD2: false, ORD3: null, ORD4: null };
let pass = true;
for (const o of result) {
    if (o.has_rating !== expected[o.id]) {
        pass = false;
        console.log(`FAIL: ${o.id} expected has_rating=${expected[o.id]}, got ${o.has_rating}`);
    }
}
console.log(pass ? "PASS: has_rating logic benar untuk semua status." : "FAIL");
process.exit(pass ? 0 : 1);
