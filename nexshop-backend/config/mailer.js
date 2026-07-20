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

module.exports = { sendOtpEmail };
