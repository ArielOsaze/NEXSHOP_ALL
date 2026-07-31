const supabase = require("./db");
const { sendWhatsAppNotification } = require("./whatsapp");

// Type yang SENGAJA gak diteruskan ke WA biar nomor tujuan gak kebanjiran
// notifikasi remeh (misal bulk-edit produk yg keseringan dipencet pas lagi
// beres-beres katalog). Tinggal hapus dari array ini kalau mau semuanya
// beneran masuk WA tanpa terkecuali.
const WA_MUTED_TYPES = [];

// Dipanggil dari controller lain buat nyatet aktivitas. Sengaja gak di-await
// secara ketat sama pemanggilnya (dan errornya ditelan di sini) — kalau
// gagal simpel ke tabel notifikasi, itu JANGAN sampai bikin request utama
// (checkout, update produk, dst) ikut gagal.
//
// Selain disimpan ke admin_notifications (buat lonceng di admin dashboard),
// tiap notifikasi di sini SEKARANG juga diteruskan ke WhatsApp (kalau
// WAAPI_URL/KEY/nomor tujuan udah dikonfigurasi di Settings > API Keys),
// jadi apapun yang muncul di dashboard bakal ke-push ke WA juga —
// sendWhatsAppNotification sendiri udah nelan errornya sendiri kalau gagal
// kirim, jadi aman dipanggil "fire-and-forget" di sini.
async function notify(type, message) {
    try {
        await supabase.from("admin_notifications").insert([{ type, message }]);
    } catch (err) {
        console.log("Gagal simpan notifikasi:", err.message);
    }

    if (!WA_MUTED_TYPES.includes(type)) {
        sendWhatsAppNotification(message);
    }
}

module.exports = { notify };
