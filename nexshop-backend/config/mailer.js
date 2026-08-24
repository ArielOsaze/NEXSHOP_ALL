const axios = require("axios");
const nodemailer = require("nodemailer");
require("dotenv").config();
const { getApiKeys, getStoreSettings } = require("./settings");
const { notify } = require("./notify");

// Kenapa pakai Brevo HTTP API, bukan nodemailer/SMTP langsung ke Gmail:
// Awalnya karena Railway (plan Hobby) memblokir koneksi SMTP keluar (port
// 25/465/587). Sekarang sudah pindah ke VPS (Rumahweb) yang portnya biasanya
// gak diblokir, JADI SMTP langsung sebenarnya bisa juga dipakai — tapi HTTP
// API tetap dipertahankan karena jalan di port 443 (sama kayak request web
// biasa), gak tergantung provider VPS/firewall/ISP block port SMTP, dan gak
// perlu ubah kode ini pas pindah-pindah hosting lagi ke depannya.
//
// PENTING: key & sender SEKARANG diambil dari tabel api_keys (bisa diatur
// dari Settings > API Keys di admin dashboard), bukan langsung process.env.
// getApiKeys() sendiri tetap fallback ke .env kalau kolom di DB masih kosong,
// jadi VPS lama yang cuma isi .env tetap jalan seperti biasa.
async function getBrevoConfig() {
    const keys = await getApiKeys();
    const apiKey = keys.brevo_api_key;
    const senderEmail = keys.brevo_sender_email;
    const senderName = keys.brevo_sender_name || "NexShop";

    if (keys.smtp_host && keys.smtp_from_email) {
        const smtpPort = Number(keys.smtp_port || 587);
        if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
            throw new Error("Port SMTP tidak valid. Periksa Admin Configuration Center.");
        }
        return {
            transport: "smtp",
            smtpHost: keys.smtp_host,
            smtpPort,
            smtpUser: keys.smtp_user,
            smtpPassword: keys.smtp_password,
            senderEmail: keys.smtp_from_email,
            senderName: keys.smtp_from_name || "NexShop"
        };
    }

    if (!apiKey || !senderEmail) {
        const msg = "Brevo API Key atau Sender Email belum diisi — cek Settings > API Keys di admin dashboard.";
        console.log("❌", msg);
        // dicatat ke notifikasi admin juga, biar keliatan di dashboard —
        // sebelumnya ini cuma nongol di server log yang gak kebaca admin
        notify("email", `❌ Gagal kirim email: ${msg}`);
        throw new Error(msg);
    }

    return { transport: "brevo", apiKey, senderEmail, senderName };
}

async function sendConfiguredEmail(config, { to, subject, htmlContent }) {
    if (config.transport === "smtp") {
        const transporter = nodemailer.createTransport({
            host: config.smtpHost,
            port: config.smtpPort,
            secure: config.smtpPort === 465,
            ...(config.smtpUser ? { auth: { user: config.smtpUser, pass: config.smtpPassword || "" } } : {})
        });
        await transporter.sendMail({ from: { name: config.senderName, address: config.senderEmail }, to, subject, html: htmlContent });
        return;
    }
    await axios.post("https://api.brevo.com/v3/smtp/email", {
        sender: { name: config.senderName, email: config.senderEmail },
        to: [{ email: to }],
        subject,
        htmlContent
    }, {
        headers: { "api-key": config.apiKey, "Content-Type": "application/json", "Accept": "application/json" }
    });
}

async function sendOtpEmail(to, otp) {
    const config = await getBrevoConfig();
    try {
        await sendConfiguredEmail(config, {
                to,
                subject: "Kode Verifikasi NexShop",
                htmlContent: `
                    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color:#00C2E8;">NexShop</h2>
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
        });
    } catch (err) {
        const detail = err.response?.data?.message || err.response?.data || err.message;
        console.log("❌ Provider email gagal kirim OTP:", detail);
        notify("email", `❌ Gagal kirim email OTP ke ${to}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
        throw err;
    }
}

// OTP ini khusus untuk perubahan Security PIN admin. Jangan gunakan template
// verifikasi akun di atas: masa berlaku dan konteksnya sengaja lebih ketat.
async function sendAdminPinChangeOtpEmail(to, otp) {
    const config = await getBrevoConfig();
    try {
        await sendConfiguredEmail(config, {
            to,
            subject: "Kode perubahan Security PIN NexShop",
            htmlContent: `
                <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;">
        <h2 style="color:#00C2E8;">NexShop</h2>
                    <p>Ada permintaan untuk mengubah Security PIN admin.</p>
                    <div style="font-size:32px;font-weight:bold;letter-spacing:6px;background:#f2f1f8;padding:16px;text-align:center;border-radius:8px;">${otp}</div>
                    <p style="color:#666;font-size:13px;margin-top:16px;">Kode ini berlaku 5 menit dan hanya dapat dipakai sekali. Jangan bagikan kepada siapa pun. Jika ini bukan kamu, segera ganti password admin.</p>
                </div>`
        });
    } catch (err) {
        const detail = err.response?.data?.message || err.response?.data || err.message;
        console.log("Gagal kirim OTP perubahan Security PIN:", detail);
        notify("security", `Gagal kirim OTP perubahan Security PIN ke ${to}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
        throw err;
    }
}

function rupiah(n) {
    return "Rp" + Number(n || 0).toLocaleString("id-ID");
}

// Invoice/receipt buat pesanan produk BIASA (bukan topup) — dikirim pas
// status order pertama kali jadi "paid". Sengaja terpisah dari email OTP
// biar gampang di-maintain/ganti template masing-masing.
async function sendOrderInvoiceEmail(to, { orderId, recipientName, items, subtotal, discountAmount, promoCode, total }) {
    const config = await getBrevoConfig();

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

    // Produk "biasa" (game key/Xbox Game Pass/bundle) DIKIRIM MANUAL via WA
    // -- beda dari topup diamond yang otomatis lewat TokoVoucher. Jadi email
    // invoice ini WAJIB kasih tau customer cara follow up, soalnya tanpa ini
    // mereka gak ada cara tau kudu ngapain abis bayar.
    const store = await getStoreSettings();
    const waDigits = (store.contact_whatsapp || "").replace(/\D/g, "");
    const waCta = waDigits ? `
        <div style="margin-top:20px; padding:16px; background:#f2f1f8; border-radius:8px;">
            <p style="margin:0 0 12px; font-size:14px;">
                🎮 <strong>Kode/produk pesanan ini dikirim manual oleh tim kami.</strong>
                Chat WhatsApp admin di bawah ini, sertakan <strong>No. Pesanan ${orderId}</strong>
                dan email ini (${to}) ya, biar cepat diproses.
            </p>
            <a href="https://wa.me/${waDigits}?text=${encodeURIComponent(`Halo admin, saya sudah bayar pesanan No. Transaksi ${orderId} dengan email ${to}. Mohon diproses ya 🙏`)}"
               style="display:inline-block; padding:10px 20px; background:#25D366; color:#fff; text-decoration:none; border-radius:100px; font-weight:bold; font-size:14px;">
                💬 Chat Admin via WhatsApp
            </a>
        </div>
    ` : "";

    try {
        await sendConfiguredEmail(config, {
                to,
                subject: `Invoice Pesanan ${orderId} — Pembayaran Berhasil`,
                htmlContent: `
                    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color:#00C2E8;">NexShop</h2>
                        <p>Halo ${recipientName || "Kak"}, pembayaran kamu udah <strong style="color:#22C55E;">berhasil</strong>. Ini invoice-nya:</p>
                        <p style="color:#888; font-size:13px; margin-bottom:20px;">No. Pesanan: <strong>${orderId}</strong></p>
                        <table style="width:100%; border-collapse:collapse; font-size:14px;">
                            ${itemRows}
                            ${discountRow}
                            <tr>
                                <td style="padding:12px 0 0; font-weight:bold;">Total</td>
              <td style="padding:12px 0 0; text-align:right; font-weight:bold; color:#00C2E8;">${rupiah(total)}</td>
                            </tr>
                        </table>
                        ${waCta}
                        <p style="color:#666; font-size:13px; margin-top:24px;">
                            Kalau ada pertanyaan lain, balas email ini atau hubungi CS kami.
                            Simpan email ini sebagai bukti pembayaran ya.
                        </p>
                    </div>
                `
        });
    } catch (err) {
        const detail = err.response?.data?.message || err.response?.data || err.message;
        console.log("❌ Provider email gagal kirim invoice order:", detail);
        notify("email", `❌ Gagal kirim invoice order ${orderId} ke ${to}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
        throw err;
    }
}

// Invoice buat pesanan TOPUP DIAMOND/VOUCHER — dikirim pas status order
// jadi "sukses" (bukan cuma "paid"), karena buat topup yang penting itu
// diamond/voucher-nya beneran udah kekirim, bukan cuma uangnya diterima.
async function sendTopupInvoiceEmail(to, { orderId, namaProduk, tujuan, serverId, harga, serialNumber }) {
    const config = await getBrevoConfig();

    try {
        await sendConfiguredEmail(config, {
                to,
                subject: `Invoice Topup ${orderId} — Diamond/Voucher Terkirim`,
                htmlContent: `
                    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color:#00C2E8;">NexShop</h2>
                        <p>Topup kamu <strong style="color:#22C55E;">berhasil terkirim</strong> ✅</p>
                        <p style="color:#888; font-size:13px; margin-bottom:20px;">No. Pesanan: <strong>${orderId}</strong></p>
                        <table style="width:100%; border-collapse:collapse; font-size:14px;">
                            <tr><td style="padding:6px 0; color:#888;">Produk</td><td style="padding:6px 0; text-align:right;">${namaProduk}</td></tr>
                            <tr><td style="padding:6px 0; color:#888;">User ID</td><td style="padding:6px 0; text-align:right;">${tujuan}</td></tr>
                            ${serverId ? `<tr><td style="padding:6px 0; color:#888;">Server ID</td><td style="padding:6px 0; text-align:right;">${serverId}</td></tr>` : ""}
                            ${serialNumber ? `<tr><td style="padding:6px 0; color:#888;">Kode/SN</td><td style="padding:6px 0; text-align:right;">${serialNumber}</td></tr>` : ""}
                            <tr>
                                <td style="padding:12px 0 0; font-weight:bold; border-top:1px solid #eee;">Total Bayar</td>
              <td style="padding:12px 0 0; text-align:right; font-weight:bold; color:#00C2E8; border-top:1px solid #eee;">${rupiah(harga)}</td>
                            </tr>
                        </table>
                        <p style="color:#666; font-size:13px; margin-top:24px;">
                            Simpan email ini sebagai bukti transaksi. Kalau item belum masuk ke akun game kamu,
                            hubungi CS kami dengan menyertakan No. Pesanan di atas.
                        </p>
                    </div>
                `
        });
    } catch (err) {
        const detail = err.response?.data?.message || err.response?.data || err.message;
        console.log("❌ Provider email gagal kirim invoice topup:", detail);
        notify("email", `❌ Gagal kirim invoice topup ${orderId} ke ${to}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
        throw err;
    }
}

// Email buat fitur "Lupa Password" -- link-nya bawa token acak (BUKAN kode
// OTP 6 digit), berlaku singkat, dan cuma bisa dipakai SEKALI (token
// dihapus dari DB begitu password berhasil diganti -- lihat resetPassword
// di authController.js).
async function sendPasswordResetEmail(to, resetLink) {
    const config = await getBrevoConfig();
    try {
        await sendConfiguredEmail(config, {
                to,
                subject: "Reset Password NexShop",
                htmlContent: `
                    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color:#00C2E8;">NexShop</h2>
                        <p>Ada permintaan buat reset password akun kamu. Klik tombol di bawah buat bikin password baru:</p>
        <a href="${resetLink}" style="display:inline-block; margin:16px 0; padding:13px 28px; background:linear-gradient(135deg,#00C2E8,#0891B2); color:#fff; text-decoration:none; border-radius:100px; font-weight:bold; font-size:14px;">
                            Reset Password
                        </a>
                        <p style="color:#666; font-size:13px;">
                            Link ini cuma berlaku 30 menit dan cuma bisa dipakai sekali. Kalau kamu
                            gak merasa minta reset password, abaikan aja email ini — password kamu
                            tetap aman dan gak berubah.
                        </p>
                        <p style="color:#999; font-size:12px; word-break:break-all;">
                            Kalau tombolnya gak bisa diklik, copy-paste link ini ke browser:<br>${resetLink}
                        </p>
                    </div>
                `
        });
    } catch (err) {
        const detail = err.response?.data?.message || err.response?.data || err.message;
        console.log("❌ Provider email gagal kirim email reset password:", detail);
        notify("email", `❌ Gagal kirim email reset password ke ${to}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
        throw err;
    }
}

module.exports = { sendOtpEmail, sendAdminPinChangeOtpEmail, sendOrderInvoiceEmail, sendTopupInvoiceEmail, sendPasswordResetEmail };
