// Sebelumnya, diskon dikirim ke iPaymu sebagai baris item TERSENDIRI dengan
// harga NEGATIF (mis. { id: "DISCOUNT", price: -15000 }). Ini yang diduga
// bikin returnUrl gak jalan normal (macet di halaman iPaymu, gak ke-redirect
// balik ke web) tiap kali ada kode promo dipakai -- kemungkinan besar iPaymu
// kurang bisa nanganin harga negatif di item_details dengan benar.
//
// Fix: diskon disebar (proporsional) ke tiap item, jadi SEMUA harga yang
// dikirim ke iPaymu tetap >= 0, tapi jumlah total tetap identik dengan
// subtotal - diskon. Sekalian di-flatten jadi qty=1 per baris (price = harga
// satuan x qty) biar gak perlu mikirin pembagian harga per unit yang bisa
// berantakan pas quantity > 1.
//
// items: [{ id, name, price, quantity }, ...] -- harga per UNIT (belum dikali qty)
// discountAmount: nominal diskon total (Rupiah, sudah dibulatkan idealnya)
function buildDiscountedIpaymuItems(items, discountAmount) {
    const lineTotals = items.map((it) => Math.round(it.price) * it.quantity);
    const subtotal = lineTotals.reduce((s, v) => s + v, 0);
    const discount = Math.max(0, Math.min(Math.round(discountAmount || 0), subtotal));

    let remaining = discount;
    return items.map((it, idx) => {
        const lineTotal = lineTotals[idx];
        const isLast = idx === items.length - 1;
        let cut = isLast ? remaining : Math.round(discount * (lineTotal / (subtotal || 1)));
        cut = Math.min(cut, lineTotal, remaining);
        remaining -= cut;

        const label = it.quantity > 1 ? `${it.name} ×${it.quantity}` : it.name;
        return {
            id: String(it.id),
            name: label.slice(0, 80),
            price: Math.max(lineTotal - cut, 0),
            quantity: 1
        };
    });
}

module.exports = { buildDiscountedIpaymuItems };
