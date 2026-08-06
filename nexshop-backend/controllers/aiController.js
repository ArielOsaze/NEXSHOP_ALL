const supabase = require("../config/db");
const { getStoreSettings, getApiKeys } = require("../config/settings");
const axios = require("axios");

// Built-in Knowledge Base Resmi NexShop
const NEXSHOP_STORE_KNOWLEDGE = `
INFORMASI UTAMA NEXSHOP:
- Tentang NexShop: NexShop adalah platform marketplace gaming 24/7 resmi di Indonesia yang menyediakan layanan topup diamond game otomatis (1-3 detik), produk digital, voucher game, dan aksesoris gaming dengan harga terjangkau dan terpercaya.
- Keunggulan NexShop: Proses instant otomatis 24 jam tanpa antri, 100% legal dan garansi aman, harga grosir termurah, dukungan metode pembayaran lengkap (QRIS, E-Wallet, VA Bank, KK), dan customer service responsif.
- Metode Pembayaran: QRIS (DANA, OVO, GoPay, ShopeePay, LinkAja), Virtual Account (BCA, Mandiri, BRI, BNI, Permata, CIMB), Transfer Bank, dan Kartu Kredit.
- Cara Topup Diamond: 1. Buka tab Topup di NexShop. 2. Pilih game (MLBB, Free Fire, PUBG Mobile, Genshin Impact, Valorant, dll). 3. Masukkan User ID dan Zone ID. 4. Pilih nominal diamond/item. 5. Pilih metode pembayaran dan selesaikan pesanan. Item masuk otomatis dalam 1-3 detik.
- Cara Gunakan Voucher / Promo: Masukkan kode promo (seperti NEXPROMO) di halaman Checkout sebelum memilih pembayaran untuk langsung memotong total belanja.
- Garansi & Kebijakan Refund: Garansi 100% uang kembali jika saldo/item tidak masuk atau stok habis dalam kurun waktu 24 jam. Pembatalan/refund dapat diklaim melalui CS WhatsApp dengan menyertakan Nomor Order ID.
- Kontak Admin CS: WhatsApp 6287792634063 / Email: support@nexshop.cloud (Aktif 24/7).
- Game yang Didukung: Mobile Legends (MLBB), Free Fire, PUBG Mobile, Genshin Impact, Valorant, Roblox, Steam Wallet Code, Xbox Game Pass, PlayStation Network (PSN), EA Sports FC, Honor of Kings, Call of Duty Mobile.
`;

// RAG (Retrieval-Augmented Generation) Helper: Cari konteks relevan di DB lokal secara real-time
async function retrieveContext(query, user) {
    const qLower = String(query || "").toLowerCase().trim();
    const contextLines = [NEXSHOP_STORE_KNOWLEDGE];
    const suggestedCards = [];

    try {
        // SELALU panggil getStoreSettings({ fresh: true }) agar jika admin baru mengganti FAQ/Syarat/Kontak, AI langsung menggunakannya!
        const settings = await getStoreSettings({ fresh: true });
        if (settings) {
            contextLines.push(`Informasi Toko Dinamis: ${settings.store_name || 'NexShop'} (${settings.store_tagline || 'Marketplace Gaming'}). WhatsApp CS: ${settings.whatsapp_number || '6287792634063'}. Email CS: ${settings.contact_email || 'support@nexshop.cloud'}.`);
            if (settings.faq_content) {
                contextLines.push(`FAQ & Panduan Toko: ${settings.faq_content}`);
            }
            if (settings.refund_content) {
                contextLines.push(`Kebijakan Refund: ${settings.refund_content}`);
            }
            if (settings.terms_content) {
                contextLines.push(`Syarat & Ketentuan: ${settings.terms_content}`);
            }
        }

        // Search Products (physical / digital)
        const { data: products } = await supabase.from("products").select("id, name, price, strike_price, sold, category, is_flash_sale, badges").limit(30);
        if (products && products.length > 0) {
            const matchedProducts = products.filter(p => p.name.toLowerCase().includes(qLower) || (p.category && p.category.toLowerCase().includes(qLower)) || qLower.includes("produk") || qLower.includes("murah") || qLower.includes("laris"));
            if (matchedProducts.length > 0) {
                contextLines.push(`Katalog Produk Terkait: ` + matchedProducts.map(p => `${p.name} - Harga: Rp${Number(p.price).toLocaleString('id-ID')}${p.is_flash_sale ? ' [FLASH SALE]' : ''} (${p.sold || 0} terjual)`).slice(0, 5).join("; "));
                matchedProducts.slice(0, 3).forEach(p => {
                    suggestedCards.push({
                        type: "product",
                        id: p.id,
                        title: p.name,
                        price: `Rp ${Number(p.price).toLocaleString('id-ID')}`,
                        badge: p.is_flash_sale ? "Flash Sale" : (p.badges?.[0] || "Toko"),
                        url: `#product-${p.id}`
                    });
                });
            }
        }

        // Search Topup Products
        const { data: topups } = await supabase.from("topup_products").select("id, kode_produk, nama, kategori, harga_jual, is_active").eq("is_active", true).limit(40);
        if (topups && topups.length > 0) {
            const matchedTopups = topups.filter(t => t.nama.toLowerCase().includes(qLower) || (t.kategori && t.kategori.toLowerCase().includes(qLower)) || qLower.includes("topup") || qLower.includes("diamond") || qLower.includes("ml") || qLower.includes("ff") || qLower.includes("pubg"));
            if (matchedTopups.length > 0) {
                contextLines.push(`Layanan Topup Diamond Terkait: ` + matchedTopups.map(t => `${t.kategori} - ${t.nama}: Rp${Number(t.harga_jual).toLocaleString('id-ID')}`).slice(0, 6).join("; "));
            }
        }

        // Search Gaming News
        const { data: news } = await supabase.from("gaming_news").select("id, title, summary, source_name, source_url").eq("is_active", true).limit(10);
        if (news && news.length > 0) {
            const matchedNews = news.filter(n => n.title.toLowerCase().includes(qLower) || (n.summary && n.summary.toLowerCase().includes(qLower)) || qLower.includes("berita") || qLower.includes("news") || qLower.includes("artikel"));
            if (matchedNews.length > 0) {
                contextLines.push(`Berita Gaming Terbaru: ` + matchedNews.map(n => `${n.title} (${n.source_name || 'Publisher'}): ${n.summary.slice(0, 100)}...`).slice(0, 3).join("; "));
            }
        }

        // Search Promo Codes
        const { data: promos } = await supabase.from("promo_codes").select("code, discount_type, discount_value, min_purchase, description").eq("is_active", true).limit(10);
        if (promos && promos.length > 0) {
            contextLines.push(`Voucher & Kode Promo Aktif: ` + promos.map(pr => `Kode [${pr.code}]: Diskon ${pr.discount_type === 'percent' ? pr.discount_value + '%' : 'Rp' + Number(pr.discount_value).toLocaleString('id-ID')} (Min. Rp${Number(pr.min_purchase).toLocaleString('id-ID')}) - ${pr.description || ''}`).join("; "));
            if (qLower.includes("promo") || qLower.includes("voucher") || qLower.includes("diskon") || qLower.includes("kode")) {
                promos.slice(0, 2).forEach(pr => {
                    suggestedCards.push({
                        type: "voucher",
                        code: pr.code,
                        title: `Kode Diskon: ${pr.code}`,
                        desc: pr.description || `Diskon ${pr.discount_value} min belanja Rp${Number(pr.min_purchase).toLocaleString('id-ID')}`
                    });
                });
            }
        }

        // Search Orders if User is authenticated
        if (user && user.id) {
            const [regOrdersRes, topupOrdersRes] = await Promise.all([
                supabase.from("orders").select("id, total, status, items, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(3),
                supabase.from("topup_orders").select("id, nama_produk, harga, status, target_user, created_at").eq("email", user.email).order("created_at", { ascending: false }).limit(3)
            ]);

            const userOrders = [...(regOrdersRes.data || []), ...(topupOrdersRes.data || [])];
            if (userOrders.length > 0) {
                contextLines.push(`Histori Pesanan Pengguna (${user.fullname || user.email}): ` + userOrders.map(o => `Order #${o.id} Status: ${o.status.toUpperCase()} (Total: Rp${Number(o.total || o.harga || 0).toLocaleString('id-ID')}, Tgl: ${new Date(o.created_at).toLocaleDateString('id-ID')})`).join("; "));
            }
        }

    } catch (err) {
        console.error("⚠️ Error retrieving RAG context:", err.message);
    }

    return {
        contextText: contextLines.join("\n\n"),
        cards: suggestedCards
    };
}

// MAIN RAG AI CHAT CONTROLLER WITH SMART INTENT ROUTING
exports.chat = async (req, res) => {
    const { message, history } = req.body;
    if (!message || typeof message !== "string" || !message.trim()) {
        return res.status(400).json({ message: "Pesan tidak boleh kosong" });
    }

    const q = message.trim();
    const qLower = q.toLowerCase();
    const user = req.user || null;

    try {
        const { contextText, cards } = await retrieveContext(q, user);
        const apiKeys = await getApiKeys();
        const apiKey = apiKeys.gemini_api_key || process.env.GEMINI_API_KEY || "";
        const model = apiKeys.gemini_news_model || process.env.GEMINI_NEWS_MODEL || "gemini-2.5-flash";

        const userName = user ? (user.fullname || user.name || "Pelanggan").split(" ")[0] : "";
        const systemPrompt = `Kamu adalah NexBot — Asisten Virtual Resmi NexShop (Marketplace Gaming & Topup Diamond).
Tugasmu adalah membantu pelanggan menjawab pertanyaan seputar produk, topup, promo, dan cara bertransaksi dengan sopan, ramah, dan ringkas dalam Bahasa Indonesia.

${userName ? `Nama pelanggan yang sedang login: ${userName}. Sapa pengguna dengan hangat (contoh: "Halo ${userName} 👋").` : ""}

ATURAN UTAMA (RAG KONTROL PENUH):
1. Utamakan informasi dari KONTEKS DATABASE NEXSHOP di bawah ini.
2. Jika ada data harga, voucher, atau status order di dalam konteks, sebutkan secara presisi.
3. JIKA INFORMASI TIDAK TERSEDIA di dalam konteks dan kamu tidak yakin, JANGAN MENGARANG. Gunakan pengetahuan dasar NexShop yang tersedia dan sarankan CS WhatsApp Admin jika butuh bantuan lebih lanjut.

KONTEKS DATABASE NEXSHOP:
${contextText || "Tidak ada informasi khusus di database."}`;

        if (apiKey) {
            try {
                const contentsPayload = [
                    { role: "user", parts: [{ text: systemPrompt }] },
                    { role: "model", parts: [{ text: "Siap, saya mengerti. Saya adalah NexBot, asisten virtual resmi NexShop." }] }
                ];

                // Append recent conversation memory (history) if provided
                if (Array.isArray(history)) {
                    history.slice(-6).forEach(item => {
                        if (item.role && item.text) {
                            contentsPayload.push({
                                role: item.role === "user" ? "user" : "model",
                                parts: [{ text: String(item.text) }]
                            });
                        }
                    });
                }

                contentsPayload.push({ role: "user", parts: [{ text: q }] });

                const response = await axios.post(
                    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
                    { contents: contentsPayload },
                    { timeout: 9000 }
                );

                const replyText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
                if (replyText) {
                    return res.json({
                        reply: replyText,
                        cards,
                        handoff: false
                    });
                }
            } catch (geminiErr) {
                console.log("⚠️ Call Gemini API gagal di NexBot Chat, memakai Smart Intent Fallback:", geminiErr.message);
            }
        }

        // Smart Intent Fallback RAG Engine (Memastikan 100% pertanyaan umum NexShop terjawab)
        let fallbackReply = userName ? `Halo ${userName} 👋 ` : `Halo 👋 `;

        if (qLower.includes("apa itu nexshop") || qLower.includes("tentang nexshop") || qLower.includes("kelebihan") || qLower.includes("kenapa beli") || qLower.includes("aman")) {
            fallbackReply += "**NexShop** adalah platform marketplace gaming 24/7 resmi di Indonesia.\n\n✨ **Keunggulan NexShop:**\n• Process Instant 1-3 detik otomatis tanpa antri.\n• 100% Legal & Garansi Aman.\n• Harga Grosir Termurah.\n• Pembayaran Lengkap (QRIS, E-Wallet, VA Bank, KK).";
        } else if (qLower.includes("metode pembayaran") || qLower.includes("bayar lewat apa") || qLower.includes("pembayaran")) {
            fallbackReply += "NexShop mendukung metode pembayaran yang lengkap:\n• **QRIS**: DANA, OVO, GoPay, ShopeePay, LinkAja.\n• **Virtual Account**: BCA, Mandiri, BRI, BNI, Permata.\n• **Kartu Kredit / Debit**.\n\nPembayaran diverifikasi otomatis 24 jam non-stop!";
        } else if (qLower.includes("topup") || qLower.includes("cara topup") || qLower.includes("ml") || qLower.includes("ff") || qLower.includes("diamond")) {
            fallbackReply += "Cara topup diamond game di NexShop sangat praktis:\n1. Buka tab **Topup** di menu atas.\n2. Pilih game (MLBB, Free Fire, PUBG, Valorant, dll).\n3. Masukkan **User ID** & **Zone ID** kamu.\n4. Pilih nominal diamond & metode pembayaran.\n5. Selesaikan pembayaran, item otomatis masuk dalam 1-3 detik!";
        } else if (qLower.includes("voucher") || qLower.includes("promo") || qLower.includes("redeem") || qLower.includes("diskon")) {
            fallbackReply += "Untuk mengklaim diskon:\n1. Gunakan kode promo seperti **NEXPROMO** di halaman Checkout.\n2. Masukkan kode pada kolom **Kode Promo** sebelum bayar untuk pemotongan harga otomatis.";
        } else if (qLower.includes("refund") || qLower.includes("garansi") || qLower.includes("batal")) {
            fallbackReply += "NexShop memberikan **Garansi 100% Uang Kembali** apabila transaksi gagal atau stok habis dalam 24 jam. Hubungi CS WhatsApp kami dengan menyertakan Nomor Order ID untuk klaim refund.";
        } else if (qLower.includes("admin") || qLower.includes("cs") || qLower.includes("kontak") || qLower.includes("hubungi") || qLower.includes("wa")) {
            fallbackReply += "Hubungi Tim Customer Service NexShop 24/7 via:\n• **WhatsApp**: 6287792634063\n• **Email**: support@nexshop.cloud";
        } else if (qLower.includes("game") || qLower.includes("kategori")) {
            fallbackReply += "Game populer yang tersedia di NexShop:\n🎮 Mobile Legends, Free Fire, PUBG Mobile, Genshin Impact, Valorant, Roblox, Steam Wallet, Xbox Game Pass, & PSN.";
        } else {
            fallbackReply += "Saya adalah **NexBot**, asisten virtual resmi NexShop. Ada yang bisa saya bantu mengenai produk game, topup diamond, promo, atau status pesanan kamu hari ini?";
        }

        res.json({
            reply: fallbackReply,
            cards,
            handoff: true
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server Error di NexBot AI Chat" });
    }
};
