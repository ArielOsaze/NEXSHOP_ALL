// ===========================================================
// HARGA RESELLER DENGAN PROTEKSI KEUNTUNGAN NEXSHOP
//
// Harga reseller dihitung dari harga jual normal dikurangi persen diskon tier.
// NexShop SELALU mendapatkan margin keuntungan bersih di setiap transaksi
// reseller (tidak pernah dijual seharga modal supplier mentah).
//
// Pengaman:
// 1. Harga reseller dibentuk dari harga jual normal - diskon tier.
// 2. Lantai harga: modal supplier + margin keuntungan minimum (1% atau min Rp 100).
// 3. Harga reseller tidak akan pernah menyentuh atau berada di bawah harga modal supplier.
// ===========================================================

const MIN_MARGIN_PERSEN = 1.0; // Minimal margin 1% dari modal
const MIN_MARGIN_FLAT = 100;   // Minimal untung flat Rp 100 untuk produk nominal kecil

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

    // Produk yang harga umumnya sudah menyentuh/menembus modal tidak boleh
    // dijual melalui jalur reseller. Jangan mengembalikan harga normal yang
    // tampak valid tetapi sebenarnya rugi.
    if (normal <= 0 || (modal > 0 && normal <= modal)) {
        return {
            harga: null,
            harga_normal: normal,
            hemat: 0,
            persen_efektif: 0,
            kena_lantai: false,
            sellable: false,
            reason: "Harga jual tidak di atas modal supplier"
        };
    }

    if (diskonPersen <= 0) {
        return { harga: normal, harga_normal: normal, hemat: 0, persen_efektif: 0, kena_lantai: false, sellable: true };
    }

    const lantai = lantaiHargaReseller(modal);
    const hargaDiskon = bulatkanRupiah(normal * (1 - diskonPersen / 100));

    // Kalau lantai margin lebih tinggi dari harga normal, tidak ada harga
    // reseller yang memenuhi aturan margin. Fail closed; jangan clamp kembali
    // ke harga normal karena itu bisa tetap di bawah modal + margin.
    if (hargaDiskon < lantai && lantai > normal) {
        return {
            harga: null,
            harga_normal: normal,
            hemat: 0,
            persen_efektif: 0,
            kena_lantai: true,
            sellable: false,
            reason: "Harga normal tidak cukup untuk memenuhi lantai margin NexShop"
        };
    }

    const harga = hargaDiskon < lantai ? lantai : hargaDiskon;
    const hemat = Math.max(normal - harga, 0);
    return {
        harga,
        harga_normal: normal,
        hemat,
        persen_efektif: normal > 0 ? Number(((hemat / normal) * 100).toFixed(2)) : 0,
        kena_lantai: hargaDiskon < lantai,
        sellable: true
    };
}

module.exports = { MIN_MARGIN_PERSEN, MIN_MARGIN_FLAT, lantaiHargaReseller, hitungHargaReseller, bulatkanRupiah };
