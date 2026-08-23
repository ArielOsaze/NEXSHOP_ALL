// ===========================================================
// HARGA RESELLER DENGAN PROTEKSI KEUNTUNGAN NEXSHOP
//
// Harga reseller dihitung dari harga jual normal dikurangi persen diskon tier.
// NexShop SELALU mendapatkan margin keuntungan bersih di setiap transaksi
// reseller (tidak pernah dijual seharga modal supplier mentah).
//
// Pengaman:
// 1. Harga reseller dibentuk dari harga jual normal - diskon tier.
// 2. Lantai harga: modal supplier + margin keuntungan minimum (1.5% atau min Rp 150).
// 3. Harga reseller tidak akan pernah menyentuh atau berada di bawah harga modal supplier.
// ===========================================================

const MIN_MARGIN_PERSEN = 1.5; // Minimal margin 1.5% dari modal
const MIN_MARGIN_FLAT = 150;    // Minimal untung flat Rp 150 untuk produk nominal kecil

function bulatkanRupiah(nilai) {
    return Math.round(Number(nilai) || 0);
}

// Batas terendah harga reseller: modal + margin minimum NexShop
function lantaiHargaReseller(hargaBeli) {
    const modal = Number(hargaBeli) || 0;
    if (modal <= 0) return 0;
    const marginPersen = Math.ceil(modal * (1 + MIN_MARGIN_PERSEN / 100));
    const marginFlat = modal + MIN_MARGIN_FLAT;
    return Math.max(marginPersen, marginFlat);
}

// Hitung harga reseller untuk 1 SKU produk
function hitungHargaReseller(hargaJual, hargaBeli, persen) {
    const normal = bulatkanRupiah(hargaJual);
    const modal = bulatkanRupiah(hargaBeli);
    const diskonPersen = Number(persen) || 0;

    if (diskonPersen <= 0 || normal <= 0) {
        return { harga: normal, harga_normal: normal, hemat: 0, persen_efektif: 0, kena_lantai: false };
    }

    const lantai = lantaiHargaReseller(modal);
    let harga = bulatkanRupiah(normal * (1 - diskonPersen / 100));
    let kenaLantai = false;

    // Pastikan harga reseller tidak tembus di bawah lantai modal + untung
    if (harga < lantai) {
        harga = Math.max(lantai, modal > 0 ? modal + 100 : normal);
        // Jangan sampai harga lantai melebihi harga normal
        if (harga > normal) {
            harga = normal;
        }
        kenaLantai = true;
    }

    const hemat = Math.max(normal - harga, 0);
    return {
        harga,
        harga_normal: normal,
        hemat,
        persen_efektif: normal > 0 ? Number(((hemat / normal) * 100).toFixed(2)) : 0,
        kena_lantai: kenaLantai
    };
}

module.exports = { MIN_MARGIN_PERSEN, MIN_MARGIN_FLAT, lantaiHargaReseller, hitungHargaReseller, bulatkanRupiah };
