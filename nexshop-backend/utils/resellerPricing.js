// ===========================================================
// HARGA RESELLER
//
// Harga reseller SELALU dihitung ulang di server dari harga jual normal +
// persen diskon tier-nya. Frontend gak pernah dipercaya ngirim harga, dan
// harga reseller gak disimpan per produk -- jadi begitu admin ubah persen
// satu tier, seluruh katalog ikut berubah tanpa perlu update ribuan baris.
//
// Pengaman yang WAJIB ada: harga reseller gak boleh nyentuh (apalagi turun
// di bawah) harga modal. Diskon tier dipakai apa adanya SELAMA hasilnya
// masih di atas lantai margin; kalau nabrak, harga dijepit di lantai itu.
// Tanpa ini, produk bermargin tipis (pulsa/PLN yang untungnya cuma ratusan
// rupiah) bakal kejual rugi begitu ada tier 5%.
// ===========================================================

// Margin minimum yang harus tetap tersisa buat kita, dihitung dari modal.
const MIN_MARGIN_PERSEN = 1;

function bulatkanRupiah(nilai) {
    return Math.round(Number(nilai) || 0);
}

// Batas terendah harga reseller: modal + margin minimum.
function lantaiHargaReseller(hargaBeli) {
    const modal = Number(hargaBeli) || 0;
    if (modal <= 0) return 0;
    return Math.ceil(modal * (1 + MIN_MARGIN_PERSEN / 100));
}

// Hitung harga buat satu produk.
//   hargaJual = harga normal yang tayang buat user biasa
//   hargaBeli = harga modal dari supplier
//   persen    = discount_percent milik tier reseller
//
// Return selalu berisi harga normal juga, supaya frontend bisa nampilin
// "harga coret" tanpa perlu manggil endpoint kedua.
function hitungHargaReseller(hargaJual, hargaBeli, persen) {
    const normal = bulatkanRupiah(hargaJual);
    const diskonPersen = Number(persen) || 0;

    if (diskonPersen <= 0 || normal <= 0) {
        return { harga: normal, harga_normal: normal, hemat: 0, persen_efektif: 0, kena_lantai: false };
    }

    const lantai = lantaiHargaReseller(hargaBeli);
    let harga = bulatkanRupiah(normal * (1 - diskonPersen / 100));
    let kenaLantai = false;

    if (harga < lantai) {
        // Diskon penuh bakal makan margin -> jepit di lantai. Kalau harga
        // normalnya sendiri udah di bawah lantai (produk bermargin minus
        // yang salah setting), reseller cukup dapat harga normal, bukan
        // malah dinaikin di atas harga user biasa.
        harga = Math.min(normal, lantai);
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

module.exports = { MIN_MARGIN_PERSEN, lantaiHargaReseller, hitungHargaReseller, bulatkanRupiah };
