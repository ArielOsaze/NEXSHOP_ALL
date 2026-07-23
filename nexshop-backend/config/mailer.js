const axios = require("axios");
require("dotenv").config();

if (!process.env.BREVO_API_KEY || !process.env.EMAIL_USER) {
    console.log("❌ BREVO_API_KEY atau EMAIL_USER belum diisi di .env");
}

// Kenapa pakai Brevo HTTP API, bukan nodemailer/SMTP langsung ke Gmail:
// Railway (plan Hobby) memblokir koneksi SMTP keluar (port 25/465/587) untuk
// mencegah penyalahgunaan spam, jadi nodemailer -> smtp.gmail.com akan selalu
// ETIMEDOUT di sana meski kredensialnya benar. HTTP API jalan di port 443
// (sama seperti request web biasa) sehingga tidak kena blokir itu.
async function sendOtpEmail(to, otp) {
    await axios.post(
        "https://api.brevo.com/v3/smtp/email",
        {
            sender: { name: "NexShop", email: process.env.EMAIL_USER },
            to: [{ email: to }],
            subject: "Kode Verifikasi NexShop",
            htmlContent: `
                <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
                    <h2 style="color:#7C3AED;">NexShop</h2>
                    <p>Gunakan kode berikut untuk memverifikasi akun kamu:</p>
                    <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; background: #f2f1f8; padding: 16px; text-align: center; border-radius: 8px;">
                        ${otp}
                    </div>
                    <p style="color:#666; font-size: 13px; margin-top: 16px;">
                        Kode ini berlaku selama 10 menit. Jangan bagikan kode ini ke siapa pun,
                        termasuk pihak yang mengaku dari NexShop.
                    </p>
                </div>
            `
        },
        {
            headers: {
                "api-key": process.env.BREVO_API_KEY,
                "Content-Type": "application/json",
                "Accept": "application/json"
            }
        }
    );
}

function rupiah(n) {
    return "Rp" + Number(n || 0).toLocaleString("id-ID");
}

// Invoice/receipt buat pesanan produk BIASA (bukan topup) — dikirim pas
// status order pertama kali jadi "paid". Sengaja terpisah dari email OTP
// biar gampang di-maintain/ganti template masing-masing.
async function sendOrderInvoiceEmail(to, { orderId, recipientName, items, subtotal, discountAmount, promoCode, total }) {
    const itemRows = items.map((i) => `
        <tr>
            <td style="padding:8px 0; border-bottom:1px solid #eee;">${i.name}${i.quantity > 1 ? ` <span style="color:#888;">×${i.quantity}</span>` : ""}</td>
            <td style="padding:8px 0; border-bottom:1px solid #eee; text-align:right; white-space:nowrap;">${rupiah(i.price * i.quantity)}</td>
        </tr>
    `).join("");

    const discountRow = discountAmount > 0 ? `
        <tr>
            <td style="padding:8px 0; color:#22C55E;">Diskon${promoCode ? ` (${promoCode})` : ""}</td>
            <td style="padding:8px 0; text-align:right; color:#22C55E;">-${rupiah(discountAmount)}</td>
        </tr>
    ` : "";

    await axios.post(
        "https://api.brevo.com/v3/smtp/email",
        {
            sender: { name: "NexShop", email: process.env.EMAIL_USER },
            to: [{ email: to }],
            subject: `Invoice Pesanan ${orderId} — Pembayaran Berhasil`,
            htmlContent: `
                <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
                    <h2 style="color:#7C3AED;">NexShop</h2>
                    <p>Halo ${recipientName || "Kak"}, pembayaran kamu udah <strong style="color:#22C55E;">berhasil</strong>. Ini invoice-nya:</p>
                    <p style="color:#888; font-size:13px; margin-bottom:20px;">No. Pesanan: <strong>${orderId}</strong></p>
                    <table style="width:100%; border-collapse:collapse; font-size:14px;">
                        ${itemRows}
                        ${discountRow}
                        <tr>
                            <td style="padding:12px 0 0; font-weight:bold;">Total</td>
                            <td style="padding:12px 0 0; text-align:right; font-weight:bold; color:#7C3AED;">${rupiah(total)}</td>
                        </tr>
                    </table>
                    <p style="color:#666; font-size:13px; margin-top:24px;">
                        Pesanan kamu lagi diproses tim NexShop. Kalau ada pertanyaan, balas email ini
                        atau hubungi CS kami. Simpan email ini sebagai bukti pembayaran ya.
                    </p>
                </div>
            `
        },
        {
            headers: {
                "api-key": process.env.BREVO_API_KEY,
                "Content-Type": "application/json",
                "Accept": "application/json"
            }
        }
    );
}

// Invoice buat pesanan TOPUP DIAMOND/VOUCHER — dikirim pas status order
// jadi "sukses" (bukan cuma "paid"), karena buat topup yang penting itu
// diamond/voucher-nya beneran udah kekirim, bukan cuma uangnya diterima.
async function sendTopupInvoiceEmail(to, { orderId, namaProduk, tujuan, serverId, harga, serialNumber }) {
    await axios.post(
        "https://api.brevo.com/v3/smtp/email",
        {
            sender: { name: "NexShop", email: process.env.EMAIL_USER },
            to: [{ email: to }],
            subject: `Invoice Topup ${orderId} — Diamond/Voucher Terkirim`,
            htmlContent: `
                <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
                    <h2 style="color:#7C3AED;">NexShop</h2>
                    <p>Topup kamu <strong style="color:#22C55E;">berhasil terkirim</strong> ✅</p>
                    <p style="color:#888; font-size:13px; margin-bottom:20px;">No. Pesanan: <strong>${orderId}</strong></p>
                    <table style="width:100%; border-collapse:collapse; font-size:14px;">
                        <tr><td style="padding:6px 0; color:#888;">Produk</td><td style="padding:6px 0; text-align:right;">${namaProduk}</td></tr>
                        <tr><td style="padding:6px 0; color:#888;">User ID</td><td style="padding:6px 0; text-align:right;">${tujuan}</td></tr>
                        ${serverId ? `<tr><td style="padding:6px 0; color:#888;">Server ID</td><td style="padding:6px 0; text-align:right;">${serverId}</td></tr>` : ""}
                        ${serialNumber ? `<tr><td style="padding:6px 0; color:#888;">Kode/SN</td><td style="padding:6px 0; text-align:right;">${serialNumber}</td></tr>` : ""}
                        <tr>
                            <td style="padding:12px 0 0; font-weight:bold; border-top:1px solid #eee;">Total Bayar</td>
                            <td style="padding:12px 0 0; text-align:right; font-weight:bold; color:#7C3AED; border-top:1px solid #eee;">${rupiah(harga)}</td>
                        </tr>
                    </table>
                    <p style="color:#666; font-size:13px; margin-top:24px;">
                        Simpan email ini sebagai bukti transaksi. Kalau item belum masuk ke akun game kamu,
                        hubungi CS kami dengan menyertakan No. Pesanan di atas.
                    </p>
                </div>
            `
        },
        {
            headers: {
                "api-key": process.env.BREVO_API_KEY,
                "Content-Type": "application/json",
                "Accept": "application/json"
            }
        }
    );
}

module.exports = { sendOtpEmail, sendOrderInvoiceEmail, sendTopupInvoiceEmail };
