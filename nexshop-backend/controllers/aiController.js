const supabase = require("../config/db");
const { getStoreSettings, getApiKeys } = require("../config/settings");
const axios = require("axios");

// RAG (Retrieval-Augmented Generation) Helper: Cari konteks relevan di DB lokal
async function retrieveContext(query, user) {
    const qLower = String(query || "").toLowerCase().trim();
    const contextLines = [];
    const suggestedCards = [];

    try {
        const settings = await getStoreSettings();
        if (settings) {
            contextLines.push(`Informasi Toko: ${settings.store_name || 'NexShop'} (${settings.store_tagline || 'Marketplace Gaming'}). WhatsApp CS: ${settings.whatsapp_number || '6287792634063'}. Email CS: ${settings.contact_email || 'support@nexshop.cloud'}.`);
            if (settings.faq_content) {
                contextLines.push(`FAQ & Panduan: ${settings.faq_content}`);
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

// MAIN RAG AI CHAT CONTROLLER
exports.chat = async (req, res) => {
    const { message } = req.body;
    if (!message || typeof message !== "string" || !message.trim()) {
        return res.status(400).json({ message: "Pesan tidak boleh kosong" });
    }

    const q = message.trim();
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
3. JIKA INFORMASI TIDAK TERSEDIA di dalam konteks dan kamu tidak yakin, JANGAN MENGARANG. Katakan dengan jujur dan ramah bahwa kamu belum menemukan informasi tersebut dan sarankan pelanggan menghubungi CS WhatsApp Admin.

KONTEKS DATABASE NEXSHOP:
${contextText || "Tidak ada informasi khusus di database."}`;

        if (apiKey) {
            try {
                const response = await axios.post(
                    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
                    {
                        contents: [
                            { role: "user", parts: [{ text: systemPrompt }] },
                            { role: "model", parts: [{ text: "Siap, saya mengerti. Saya adalah NexBot, asisten virtual resmi NexShop." }] },
                            { role: "user", parts: [{ text: q }] }
                        ]
                    },
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
                console.log("⚠️ Call Gemini API gagal di NexBot Chat, memakai fallback RAG local:", geminiErr.message);
            }
        }

        // Fallback RAG jika Gemini API Key belum ada atau kuota terlampaui
        let fallbackReply = userName ? `Halo ${userName} 👋 Saya **NexBot**.\n\n` : `Halo 👋 Saya **NexBot**.\n\n`;
        if (q.toLowerCase().includes("topup") || q.toLowerCase().includes("ml") || q.toLowerCase().includes("diamond")) {
            fallbackReply += "Untuk melakukan topup diamond game (Mobile Legends, Free Fire, PUBG, dll):\n1. Masuk ke tab **Topup** di menu navigasi utama.\n2. Pilih game dan nominal diamond.\n3. Masukkan User ID / Zone ID kamu.\n4. Pilih metode pembayaran dan selesaikan transaksi secara otomatis!";
        } else if (q.toLowerCase().includes("promo") || q.toLowerCase().includes("voucher") || q.toLowerCase().includes("diskon")) {
            fallbackReply += "Gunakan kode promo aktif seperti **NEXPROMO** atau ikuti event Flash Sale di halaman utama untuk mendapatkan harga diskon spesial!";
        } else {
            fallbackReply += "Maaf, saya belum menemukan informasi spesifik mengenai pertanyaan Anda. Silakan hubungi CS Admin via WhatsApp untuk bantuan langsung!";
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
