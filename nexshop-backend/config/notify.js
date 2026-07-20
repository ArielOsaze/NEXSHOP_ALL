const supabase = require("./db");

// Dipanggil dari controller lain buat nyatet aktivitas. Sengaja gak di-await
// secara ketat sama pemanggilnya (dan errornya ditelan di sini) — kalau
// gagal simpel ke tabel notifikasi, itu JANGAN sampai bikin request utama
// (checkout, update produk, dst) ikut gagal.
async function notify(type, message) {
    try {
        await supabase.from("admin_notifications").insert([{ type, message }]);
    } catch (err) {
        console.log("Gagal simpan notifikasi:", err.message);
    }
}

module.exports = { notify };
