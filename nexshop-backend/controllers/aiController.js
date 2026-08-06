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

// Smart Query Preprocessor & Synonym Mapping (Toleransi Typo & Abstraksi Istilah)
function normalizeAndExpandQuery(query) {
    if (!query) return { raw: "", tokens: [], expandedTerms: [] };

    let q = String(query).toLowerCase().trim();
    // Normalisasi spasi dan tanda baca
    q = q.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

    const synonymMap = [
        { terms: ["ml", "mlbb", "mobile legend", "mobile legends", "mobilelegend"], expanded: ["mobile legends", "mlbb", "diamond ml"] },
        { terms: ["ff", "freefire", "free fire"], expanded: ["free fire", "ff", "diamond ff"] },
        { terms: ["pubg", "pubgm", "pubg mobile", "uc pubg"], expanded: ["pubg mobile", "uc pubg"] },
        { terms: ["val", "valorant", "vp", "valorant point"], expanded: ["valorant", "vp", "points"] },
        { terms: ["xgp", "gampass", "gamepas", "game pass", "xbox pass", "xbox game pass"], expanded: ["xbox game pass", "xbox", "game pass"] },
        { terms: ["steam", "steam wallet", "voucher steam"], expanded: ["steam wallet", "steam code"] },
        { terms: ["genshin", "primogem", "welkin"], expanded: ["genshin impact", "primogems"] },
        { terms: ["roblox", "robux"], expanded: ["roblox", "robux"] },
        { terms: ["promo", "diskon", "voucher", "kupon", "potongan"], expanded: ["promo", "voucher", "diskon"] },
        { terms: ["bayar", "pembayaran", "qris", "bank", "va", "transfer"], expanded: ["pembayaran", "qris", "virtual account"] },
        { terms: ["garansi", "refund", "batal", "kembali uang"], expanded: ["refund", "garansi"] },
        { terms: ["kontak", "admin", "cs", "wa", "whatsapp"], expanded: ["whatsapp", "contact", "support"] }
    ];

    const tokens = q.split(" ");
    const expandedTerms = new Set([q]);

    synonymMap.forEach(item => {
        const matches = item.terms.some(t => q.includes(t) || tokens.includes(t));
        if (matches) {
            item.expanded.forEach(exp => expandedTerms.add(exp));
        }
    });

    return {
        raw: q,
        tokens,
        expandedTerms: Array.from(expandedTerms)
    };
}

// Intent Detection Helper
function detectUserIntent(query) {
    const q = (query || "").toLowerCase();
    if (q.includes("beda") || q.includes("perbedaan") || q.includes("vs") || q.includes("komparasi") || q.includes("kelebihan kekurangan")) {
        return "Comparison";
    }
    if (q.includes("cara") || q.includes("bagaimana") || q.includes("langkah") || q.includes("panduan") || q.includes("buka")) {
        return "Guide";
    }
    if (q.includes("apa itu") || q.includes("maksud") || q.includes("pengertian") || q.includes("adalah")) {
        return "Definition";
    }
    if (q.includes("promo") || q.includes("diskon") || q.includes("voucher") || q.includes("kupon")) {
        return "Promotion";
    }
    if (q.includes("harga") || q.includes("berapa") || q.includes("murah")) {
        return "Pricing";
    }
    if (q.includes("garansi") || q.includes("refund") || q.includes("batal")) {
        return "Policy";
    }
    if (q.includes("status") || q.includes("pesanan") || q.includes("order")) {
        return "Order";
    }
    return "General";
}

// Weighted Knowledge Item Scorer (Title 40%, Keyword 25%, Category 10%, Content 25%)
function calculateKnowledgeScore(item, query, expandedTerms, intent) {
    let score = 0;
    const titleLower = (item.title || "").toLowerCase();
    const keywordsLower = (item.keywords || "").toLowerCase();
    const catLower = (item.category || "").toLowerCase();
    const contentLower = (item.content || "").toLowerCase();
    const qLower = query.toLowerCase();

    expandedTerms.forEach(term => {
        if (!term) return;
        if (titleLower.includes(term)) score += 40;
        if (keywordsLower.includes(term)) score += 25;
        if (catLower.includes(term)) score += 10;
        if (contentLower.includes(term)) score += 25;
    });

    // Penanganan Intent Presisi untuk Definition & Comparison
    if (intent === "Definition" || intent === "Comparison") {
        if (qLower.includes("sharing") && (titleLower.includes("sharing") || keywordsLower.includes("sharing") || contentLower.includes("sharing"))) {
            score += 60;
        }
        if (qLower.includes("private") && (titleLower.includes("private") || keywordsLower.includes("private") || contentLower.includes("private"))) {
            score += 60;
        }
        if (titleLower.includes("faq") || catLower.includes("faq")) {
            score += 30;
        }
        if (titleLower.includes("cara membeli") || titleLower.includes("panduan produk")) {
            score -= 40; // Kurangi bobot panduan generik saat user meminta definisi/perbedaan
        }
    }

    return score;
}

// RAG (Retrieval-Augmented Generation) Helper: Cari konteks relevan di DB lokal secara real-time
async function retrieveContext(query, user) {
    const { raw: qLower, expandedTerms } = normalizeAndExpandQuery(query);
    const intent = detectUserIntent(query);
    const contextLines = [];
    const suggestedCards = [];

    console.log(`\n======================================================`);
    console.log(`🔍 [RAG AUDIT LOG] PIPELINE RETRIEVAL STARTED`);
    console.log(`• Raw Query   : "${query}"`);
    console.log(`• Normalized  : "${qLower}"`);
    console.log(`• Expanded    : [${expandedTerms.join(", ")}]`);
    console.log(`• Intent      : ${intent}`);
    console.log(`======================================================`);

    const isTermMatched = (text) => {
        if (!text) return false;
        const txtLower = String(text).toLowerCase();
        return expandedTerms.some(term => txtLower.includes(term));
    };

    let topKbItems = [];
    let maxScore = 0;

    try {
        // Search Dynamic knowledge_base Table (Top 1-3 Items)
        const { data: kbItems } = await supabase.from("knowledge_base").select("id, title, category, keywords, content").eq("status", "active").order("priority", { ascending: false }).limit(50);
        const activeKbList = (kbItems && kbItems.length > 0) ? kbItems : inMemoryKnowledgeBase.filter(k => k.status === 'active');
        
        // Hitung skor berbobot & rangking seluruh kandidat
        const scoredKb = activeKbList.map(k => ({
            ...k,
            score: calculateKnowledgeScore(k, query, expandedTerms, intent)
        })).filter(k => k.score > 0).sort((a, b) => b.score - a.score);

        console.log(`📊 [RAG AUDIT LOG] KNOWLEDGE BASE CANDIDATE SCORES:`);
        scoredKb.slice(0, 5).forEach((k, idx) => {
            console.log(`  ${idx + 1}. [Score ${k.score}] "${k.title}" (${k.category || 'FAQ'})`);
        });

        if (scoredKb.length > 0) {
            maxScore = scoredKb[0].score;
            const limitCount = (intent === "Comparison") ? 3 : 2;
            topKbItems = scoredKb.slice(0, limitCount);
            contextLines.push(`Knowledge Base Terkait:\n` + topKbItems.map(k => `[${k.category || 'FAQ'}] ${k.title}:\n${k.content}`).join("\n---\n"));
        }
    } catch (e) {
        const scoredKb = inMemoryKnowledgeBase.filter(k => k.status === 'active').map(k => ({
            ...k,
            score: calculateKnowledgeScore(k, query, expandedTerms, intent)
        })).filter(k => k.score > 0).sort((a, b) => b.score - a.score);

        if (scoredKb.length > 0) {
            maxScore = scoredKb[0].score;
            topKbItems = scoredKb.slice(0, 2);
            contextLines.push(`Knowledge Base Terkait:\n` + topKbItems.map(k => `[${k.category || 'FAQ'}] ${k.title}:\n${k.content}`).join("\n---\n"));
        }
    }

    // Jika Knowledge Base tidak ditemukan, tambahkan rekomendasi produk/topup ringan
    if (topKbItems.length === 0) {
        try {
            const { data: products } = await supabase.from("products").select("id, name, price, is_flash_sale, badges").limit(10);
            if (products && products.length > 0) {
                const matchedProducts = products.filter(p => isTermMatched(p.name) || isTermMatched(p.category));
                if (matchedProducts.length > 0) {
                    contextLines.push(`Produk Terkait: ` + matchedProducts.map(p => `${p.name} (Rp${Number(p.price).toLocaleString('id-ID')})`).slice(0, 3).join("; "));
                }
            }
        } catch (err) {}
    }

    // Search Orders jika User terautentikasi
    if (user && user.id) {
        try {
            const [regOrdersRes, topupOrdersRes] = await Promise.all([
                supabase.from("orders").select("id, total, status, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(2),
                supabase.from("topup_orders").select("id, nama_produk, harga, status, created_at").eq("email", user.email).order("created_at", { ascending: false }).limit(2)
            ]);

            const userOrders = [...(regOrdersRes.data || []), ...(topupOrdersRes.data || [])];
            if (userOrders.length > 0) {
                contextLines.push(`Histori Pesanan (${user.fullname || user.email}): ` + userOrders.map(o => `Order #${o.id} (${o.status.toUpperCase()})`).join("; "));
            }
        } catch (err) {}
    }

    console.log(`✅ [RAG AUDIT LOG] SELECTED KNOWLEDGE (Top Score: ${maxScore}):`);
    topKbItems.forEach(k => console.log(`  - [Score ${k.score}] [${k.category}] ${k.title}`));
    console.log(`======================================================\n`);

    return {
        contextText: contextLines.join("\n\n"),
        cards: suggestedCards,
        intent,
        topKbItems,
        maxScore
    };
}

// UUID Helper
function isUuid(val) {
    if (!val || typeof val !== "string") return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
}

// Helper Simpan Percakapan ke Supabase (ai_conversations / ai_conversation_memory)
async function saveConversationMemoryRecord({ userId, sessionId, role, message, intent, contextText }) {
    const validUuid = isUuid(userId) ? userId : null;
    console.log(`💾 [AI MEMORY LOG] Saving Conversation Record (Role: ${role}, Session: ${sessionId}, User UUID: ${validUuid || 'Guest/Non-UUID'})...`);
    const payload = {
        user_id: validUuid,
        session_id: String(sessionId || 'sess-' + Date.now()),
        role: String(role),
        message: String(message),
        intent: intent || 'General',
        context: contextText ? { summary: contextText.slice(0, 300) } : {},
        created_at: new Date().toISOString()
    };

    try {
        const { data, error } = await supabase.from("ai_conversations").insert([payload]).select().single();
        if (error) {
            const fallbackRes = await supabase.from("ai_conversation_memory").insert([payload]).select().single();
            if (fallbackRes.error) {
                console.error("❌ [AI MEMORY LOG] Conversation Failed to Save:", error.message || fallbackRes.error.message);
                return null;
            }
            console.log("✅ [AI MEMORY LOG] Conversation Saved to ai_conversation_memory table!");
            return fallbackRes.data;
        }
        console.log("✅ [AI MEMORY LOG] Conversation Saved to ai_conversations table!");
        return data;
    } catch (err) {
        console.error("❌ [AI MEMORY LOG] Conversation Failed to Save (Exception):", err.message);
        return null;
    }
}

// Helper Update Memori User ke Supabase (ai_user_memories / ai_user_memory)
async function saveOrUpdateUserMemoryRecord(user, query, intent) {
    if (!user) return;
    const validUuid = isUuid(user.id) ? user.id : (isUuid(user.uuid) ? user.uuid : null);
    if (!validUuid) {
        console.log(`⚠️ [AI MEMORY LOG] User ID '${user.id}' is non-UUID. Skipping ai_user_memories upsert.`);
        return;
    }

    console.log(`👤 [AI MEMORY LOG] Updating User Memory for ${user.fullname || user.email} (${validUuid})...`);
    const qLower = (query || "").toLowerCase();
    let favGame = null;
    if (qLower.includes("ml") || qLower.includes("mobile legend")) favGame = "Mobile Legends";
    else if (qLower.includes("ff") || qLower.includes("free fire")) favGame = "Free Fire";
    else if (qLower.includes("pubg")) favGame = "PUBG Mobile";
    else if (qLower.includes("valorant")) favGame = "Valorant";
    else if (qLower.includes("xbox") || qLower.includes("game pass")) favGame = "Xbox Game Pass";

    const payload = {
        user_id: validUuid,
        favorite_game: favGame,
        last_seen_at: new Date().toISOString(),
        custom_preferences: { last_query: query, last_intent: intent }
    };

    try {
        const { error } = await supabase.from("ai_user_memories").upsert([payload], { onConflict: "user_id" });
        if (error) {
            await supabase.from("ai_user_memory").upsert([payload], { onConflict: "user_id" });
        }
        console.log("✅ [AI MEMORY LOG] User Memory Updated Successfully!");
    } catch (err) {
        console.error("⚠️ [AI MEMORY LOG] User Memory Update Skipped:", err.message);
    }
}

// MAIN RAG AI CHAT CONTROLLER WITH SMART INTENT ROUTING & AI MEMORY
exports.chat = async (req, res) => {
    const { message, history, session_id } = req.body;
    if (!message || typeof message !== "string" || !message.trim()) {
        return res.status(400).json({ message: "Pesan tidak boleh kosong" });
    }

    const q = message.trim();
    const user = req.user || null;
    const activeSessionId = session_id || req.headers["x-session-id"] || "sess-" + Date.now();

    try {
        const { contextText, cards, intent, topKbItems, maxScore } = await retrieveContext(q, user);

        // 1. Simpan Pesan User ke Database Memory
        saveConversationMemoryRecord({
            userId: user?.id,
            sessionId: activeSessionId,
            role: "user",
            message: q,
            intent,
            contextText
        }).catch(e => console.error("Memory User Save Error:", e));

        const userName = user ? (user.fullname || user.name || "Pelanggan").split(" ")[0] : "";
        
        // Ringkas System Prompt (~180 token / ~750 karakter)
        const systemPrompt = `Kamu adalah NexBot — Asisten Virtual Resmi NexShop (Marketplace Gaming & Topup).

ATURAN UTAMA:
1. KONTEKS DATABASE NEXSHOP ADALAH SATU-SATUNYA SUMBER FAKTA.
2. DILARANG MENGARANG FAKTA ATAU MENGUBAH ISTILAH/POIN DARI KONTEKS.
3. GUNAKAN FORMAT MARKDOWN LENGKAP & RAPI.
4. JIKA KNOWLEDGE TIDAK TERSEDIA, JAWAB BAHWA INFORMASI BELUM TERSEDIA.
${userName ? `5. SAPA PENGGUNA TERLEBIH DAHULU: "Halo ${userName} 👋"` : ""}

KONTEKS DATABASE NEXSHOP:
${contextText || "Belum ada konteks khusus."}`;

        console.log(`🤖 [RAG AUDIT LOG] PROMPT AUDIT & TOKEN ESTIMATION:`);
        console.log(`• System Prompt Length: ${systemPrompt.length} chars (~${Math.ceil(systemPrompt.length / 4)} tokens)`);
        console.log(`• User Message Length : ${q.length} chars (~${Math.ceil(q.length / 4)} tokens)`);
        console.log(`• Total Token Est.    : ~${Math.ceil((systemPrompt.length + q.length) / 4)} tokens`);

        let finalReplyText = "";
        let isHandoff = false;

        // ⚡ RULE ENGINE: Jika Similarity / Score >= 90 (High Match), Render Knowledge LANGSUNG tanpa panggil Gemini!
        if (maxScore >= 90 && topKbItems && topKbItems.length > 0) {
            console.log(`⚡ [RULE ENGINE] High Match (Score ${maxScore} >= 90). Rendering Knowledge Base DIRECTLY without Gemini API call!`);
            let directKbReply = userName ? `Halo ${userName} 👋 ` : `Halo 👋 `;
            directKbReply += `Berikut informasi resmi dari Knowledge Base NexShop:\n\n`;
            directKbReply += topKbItems.map(k => `📌 **${k.title}** (${k.category || 'FAQ'})\n${k.content}`).join("\n\n---\n\n");
            finalReplyText = directKbReply;
        } else {
            // 🌐 MEDIUM / LOW MATCH (Score < 90): Panggil Gemini API
            const apiKeys = await getApiKeys();
            const apiKey = apiKeys.gemini_api_key || process.env.GEMINI_API_KEY || "";
            const model = apiKeys.gemini_news_model || process.env.GEMINI_NEWS_MODEL || "gemini-2.5-flash";

            if (apiKey) {
                try {
                    let fullPrompt = `${systemPrompt}\n\n`;

                    if (Array.isArray(history) && history.length > 0) {
                        fullPrompt += `RIWAYAT PERCAKAPAN SEBELUMNYA:\n`;
                        history.slice(-3).forEach(item => {
                            if (item.text) {
                                fullPrompt += `${item.role === 'user' ? 'Pengguna' : 'NexBot'}: ${item.text}\n`;
                            }
                        });
                        fullPrompt += `\n`;
                    }

                    fullPrompt += `PERTANYAAN SEKARANG:\nPengguna: ${q}\nNexBot:`;

                    const targetUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
                    
                    console.log(`🚀 Sending 1 Request to Gemini (${model})...`);
                    const response = await axios.post(
                        targetUrl,
                        {
                            contents: [{ parts: [{ text: fullPrompt }] }],
                            generationConfig: {
                                temperature: 0.3,
                                maxOutputTokens: 1500
                            }
                        },
                        {
                            timeout: 15000,
                            headers: { "Content-Type": "application/json" }
                        }
                    );

                    finalReplyText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
                    if (finalReplyText) {
                        const respTokensEst = Math.ceil(finalReplyText.length / 4);
                        console.log(`✨ [RAG AUDIT LOG] GEMINI RESPONSE RECEIVED SUCCESS (HTTP ${response.status}, ${finalReplyText.length} chars, ~${respTokensEst} output tokens).`);
                    }
                } catch (geminiErr) {
                    const httpStatus = geminiErr.response ? geminiErr.response.status : "NO_STATUS";
                    const errorBody = geminiErr.response ? JSON.stringify(geminiErr.response.data) : geminiErr.message;
                    console.error(`❌ [GEMINI AUDIT ERROR] HTTP Status: ${httpStatus}`);
                    console.error(`❌ [GEMINI AUDIT ERROR] Full Error Body:`, errorBody);
                    console.log("⚠️ Call Gemini API gagal, beralih ke Direct RAG Knowledge Base Renderer!");
                }
            }
        }

        // 🛡️ CRITICAL RAG FALLBACK RENDERER: Jika Gemini gagal/kosong tetapi Knowledge Base ditemukan, render isi Knowledge Base secara LANGSUNG & LENGKAP tanpa dirangkum!
        if (!finalReplyText && topKbItems && topKbItems.length > 0) {
            console.log(`🛡️ [RAG FALLBACK RENDERER] Gemini offline/429. Rendering ${topKbItems.length} Knowledge Base items directly...`);
            let directKbReply = userName ? `Halo ${userName} 👋 ` : `Halo 👋 `;
            directKbReply += `Berikut informasi resmi dari Knowledge Base NexShop mengenai pertanyaan Anda:\n\n`;
            directKbReply += topKbItems.map(k => `📌 **${k.title}** (${k.category || 'FAQ'})\n${k.content}`).join("\n\n---\n\n");
            finalReplyText = directKbReply;
        }

        // Smart Intent Fallback RAG Engine jika Knowledge Base juga kosong & Gemini gagal
        if (!finalReplyText) {
            isHandoff = true;
            const { raw: qNorm, expandedTerms } = normalizeAndExpandQuery(q);
            const hasTerm = (t) => expandedTerms.some(term => term.includes(t) || qNorm.includes(t));

            let fallbackReply = userName ? `Halo ${userName} 👋 ` : `Halo 👋 `;

            if (hasTerm("sharing") || hasTerm("private") || intent === "Comparison") {
                fallbackReply += "**Perbedaan Xbox Game Pass Sharing vs Private di NexShop:**\n\n" +
                    "• **Xbox Game Pass Private**:\n" +
                    "  - Menggunakan **akun Anda sendiri** (100% Personal).\n" +
                    "  - Bebas mengganti password & email.\n" +
                    "  - Mendukung penuh EA Play (EA FC), Ubisoft Connect, & Call of Duty di PC/Xbox.\n\n" +
                    "• **Xbox Game Pass Sharing**:\n" +
                    "  - Menggunakan akun sekunder yang disediakan.\n" +
                    "  - Harga lebih ekonomis / hemat.\n" +
                    "  - Tetap dapat memainkan ratusan game Game Pass dengan aman.";
            } else if (hasTerm("xbox") || hasTerm("game pass") || hasTerm("xgp")) {
                fallbackReply += "Untuk membeli **Xbox Game Pass** di NexShop:\n1. Masuk ke halaman **Produk / Topup**.\n2. Pilih kategori **Xbox Game Pass**.\n3. Pilih durasi langganan (Sharing / Private).\n4. Lakukan pembayaran via QRIS / E-Wallet / VA Bank.\n5. Akses lisensi akan dikirimkan otomatis 1-3 detik!";
            } else if (hasTerm("steam") || hasTerm("steam wallet")) {
                fallbackReply += "Untuk membeli **Steam Wallet Code** di NexShop:\n1. Pilih nominal voucher Steam Wallet.\n2. Selesaikan pembayaran otomatis.\n3. Kode voucher akan tampil dan dapat di-redeem langsung di akun Steam Anda!";
            } else if (hasTerm("apa itu nexshop") || hasTerm("tentang nexshop") || hasTerm("kelebihan") || hasTerm("kenapa beli") || hasTerm("aman")) {
                fallbackReply += "**NexShop** adalah platform marketplace gaming 24/7 resmi di Indonesia.\n\n✨ **Keunggulan NexShop:**\n• Process Instant 1-3 detik otomatis tanpa antri.\n• 100% Legal & Garansi Aman.\n• Harga Grosir Termurah.\n• Pembayaran Lengkap (QRIS, E-Wallet, VA Bank, KK).";
            } else if (hasTerm("pembayaran") || hasTerm("bayar") || hasTerm("qris") || hasTerm("va")) {
                fallbackReply += "NexShop mendukung metode pembayaran yang lengkap:\n• **QRIS**: DANA, OVO, GoPay, ShopeePay, LinkAja.\n• **Virtual Account**: BCA, Mandiri, BRI, BNI, Permata.\n• **Kartu Kredit / Debit**.\n\nPembayaran diverifikasi otomatis 24 jam non-stop!";
            } else if (hasTerm("topup") || hasTerm("ml") || hasTerm("ff") || hasTerm("pubg") || hasTerm("valorant")) {
                fallbackReply += "Cara topup diamond game di NexShop sangat praktis:\n1. Buka tab **Topup** di menu atas.\n2. Pilih game (MLBB, Free Fire, PUBG, Valorant, dll).\n3. Masukkan **User ID** & **Zone ID** kamu.\n4. Pilih nominal diamond & metode pembayaran.\n5. Selesaikan pembayaran, item otomatis masuk dalam 1-3 detik!";
            } else if (hasTerm("voucher") || hasTerm("promo") || hasTerm("diskon")) {
                fallbackReply += "Untuk mengklaim diskon:\n1. Gunakan kode promo seperti **NEXPROMO** di halaman Checkout.\n2. Masukkan kode pada kolom **Kode Promo** sebelum bayar untuk pemotongan harga otomatis.";
            } else if (hasTerm("refund") || hasTerm("garansi")) {
                fallbackReply += "NexShop memberikan **Garansi 100% Uang Kembali** apabila transaksi gagal atau stok habis dalam 24 jam. Hubungi CS WhatsApp kami dengan menyertakan Nomor Order ID untuk klaim refund.";
            } else if (hasTerm("whatsapp") || hasTerm("contact") || hasTerm("support")) {
                fallbackReply += "Hubungi Tim Customer Service NexShop 24/7 via:\n• **WhatsApp**: 6287792634063\n• **Email**: support@nexshop.cloud";
            } else {
                fallbackReply += "Saya adalah **NexBot**, asisten virtual resmi NexShop. Ada yang bisa saya bantu mengenai produk game, topup diamond, promo, atau status pesanan kamu hari ini?";
            }
            finalReplyText = fallbackReply;
        }

        // 2. Simpan Balasan Assistant ke Database Memory
        saveConversationMemoryRecord({
            userId: user?.id,
            sessionId: activeSessionId,
            role: "assistant",
            message: finalReplyText,
            intent,
            contextText
        }).catch(e => console.error("Memory Assistant Save Error:", e));

        // 3. Update User Memory jika user login
        if (user) {
            saveOrUpdateUserMemoryRecord(user, q, intent).catch(e => console.error("User Memory Update Error:", e));
        }

        res.json({
            reply: finalReplyText,
            cards,
            session_id: activeSessionId,
            handoff: isHandoff
        });

    } catch (err) {
        console.error("❌ Error di NexBot AI Chat:", err);
        res.status(500).json({ message: "Server Error di NexBot AI Chat: " + err.message });
    }
};

// In-memory fallback if table knowledge_base doesn't exist yet in Supabase
let inMemoryKnowledgeBase = [
    { id: "kb-1", title: "Keunggulan NexShop", category: "Store Info", keywords: "kelebihan,kenapa beli,aman,legal", content: "NexShop adalah marketplace gaming 24/7 resmi di Indonesia. Proses instant 1-3 detik, 100% legal, harga grosir termurah, dan garansi aman.", status: "active", priority: 10 },
    { id: "kb-2", title: "Cara Topup Diamond MLBB & Game", category: "Topup Guide", keywords: "topup,ml,ff,pubg,diamond,cara beli", content: "Buka tab Topup, pilih game, masukkan User ID & Zone ID, pilih nominal item dan metode pembayaran. Transaksi diproses otomatis 1-3 detik.", status: "active", priority: 10 },
    { id: "kb-3", title: "Metode Pembayaran Lengkap", category: "Payment Method", keywords: "pembayaran,bayar,qris,ovo,dana,gopay,va", content: "Mendukung QRIS (DANA, OVO, GoPay, ShopeePay), Virtual Account Bank (BCA, Mandiri, BRI, BNI), dan Kartu Kredit.", status: "active", priority: 9 }
];

// Admin Controller: Get All Knowledge Entries
exports.getKnowledgeBase = async (req, res) => {
    try {
        const { data, error } = await supabase.from("knowledge_base").select("*").order("priority", { ascending: false });
        if (error || !data) {
            return res.json({ data: inMemoryKnowledgeBase, isFallback: true });
        }
        res.json({ data, isFallback: false });
    } catch (err) {
        res.json({ data: inMemoryKnowledgeBase, isFallback: true });
    }
};

// Admin Controller: Create Knowledge Entry
exports.createKnowledgeBase = async (req, res) => {
    const { title, category, keywords, content, status, priority } = req.body;
    if (!title || !content) {
        return res.status(400).json({ message: "Judul dan Konten wajib diisi" });
    }

    const newItem = {
        title: title.trim(),
        category: (category || "Umum").trim(),
        keywords: (keywords || "").trim(),
        content: content.trim(),
        status: status || "active",
        priority: Number(priority) || 0,
        updated_at: new Date().toISOString()
    };

    try {
        const { data, error } = await supabase.from("knowledge_base").insert([newItem]).select().single();
        if (error || !data) {
            newItem.id = "kb-" + Date.now();
            newItem.created_at = new Date().toISOString();
            inMemoryKnowledgeBase.unshift(newItem);
            return res.status(201).json({ message: "Knowledge berhasil ditambahkan (Memory Mode)", data: newItem });
        }
        res.status(201).json({ message: "Knowledge berhasil ditambahkan ke Database", data });
    } catch (err) {
        newItem.id = "kb-" + Date.now();
        newItem.created_at = new Date().toISOString();
        inMemoryKnowledgeBase.unshift(newItem);
        res.status(201).json({ message: "Knowledge berhasil ditambahkan (Memory Mode)", data: newItem });
    }
};

// Admin Controller: Update Knowledge Entry
exports.updateKnowledgeBase = async (req, res) => {
    const { id } = req.params;
    const { title, category, keywords, content, status, priority } = req.body;

    const updatePayload = {
        title: title ? title.trim() : undefined,
        category: category ? category.trim() : undefined,
        keywords: keywords ? keywords.trim() : undefined,
        content: content ? content.trim() : undefined,
        status: status || undefined,
        priority: priority !== undefined ? Number(priority) : undefined,
        updated_at: new Date().toISOString()
    };

    try {
        const { data, error } = await supabase.from("knowledge_base").update(updatePayload).eq("id", id).select().single();
        if (error || !data) {
            const idx = inMemoryKnowledgeBase.findIndex(k => String(k.id) === String(id));
            if (idx !== -1) {
                inMemoryKnowledgeBase[idx] = { ...inMemoryKnowledgeBase[idx], ...updatePayload };
                return res.json({ message: "Knowledge berhasil diperbarui (Memory Mode)", data: inMemoryKnowledgeBase[idx] });
            }
            return res.status(404).json({ message: "Knowledge tidak ditemukan" });
        }
        res.json({ message: "Knowledge berhasil diperbarui", data });
    } catch (err) {
        const idx = inMemoryKnowledgeBase.findIndex(k => String(k.id) === String(id));
        if (idx !== -1) {
            inMemoryKnowledgeBase[idx] = { ...inMemoryKnowledgeBase[idx], ...updatePayload };
            return res.json({ message: "Knowledge berhasil diperbarui (Memory Mode)", data: inMemoryKnowledgeBase[idx] });
        }
        res.status(500).json({ message: "Gagal memperbarui knowledge" });
    }
};

// Admin Controller: Delete Knowledge Entry
exports.deleteKnowledgeBase = async (req, res) => {
    const { id } = req.params;
    try {
        await supabase.from("knowledge_base").delete().eq("id", id);
        inMemoryKnowledgeBase = inMemoryKnowledgeBase.filter(k => String(k.id) !== String(id));
        res.json({ message: "Knowledge berhasil dihapus" });
    } catch (err) {
        inMemoryKnowledgeBase = inMemoryKnowledgeBase.filter(k => String(k.id) !== String(id));
        res.json({ message: "Knowledge berhasil dihapus" });
    }
};

// Admin Controller: Auto Knowledge Seeder & Rebuilder
exports.reseedKnowledgeBase = async (req, res) => {
    try {
        const generatedItems = [];

        // 1. Seed Store Info & Policies
        const settings = await getStoreSettings({ fresh: true });
        if (settings) {
            generatedItems.push({
                title: "Tentang NexShop & Keunggulan",
                category: "Store Info",
                keywords: "nexshop, tentang nexshop, kelebihan, keunggulan, aman, legal, terpercaya",
                content: `NexShop adalah platform marketplace gaming 24/7 resmi di Indonesia. Layanan instant 1-3 detik, garansi 100% legal & aman, harga grosir termurah, dan dukungan pembayaran lengkap.`,
                priority: 10,
                status: "active"
            });
            if (settings.faq_content) {
                generatedItems.push({
                    title: "FAQ & Pertanyaan Umum",
                    category: "FAQ",
                    keywords: "faq, tanya jawab, pertanyaan, cara beli, cara bayar",
                    content: settings.faq_content,
                    priority: 9,
                    status: "active"
                });
            }
            if (settings.refund_content) {
                generatedItems.push({
                    title: "Kebijakan Garansi & Refund",
                    category: "Policy",
                    keywords: "garansi, refund, pengembalian dana, batal, komplain, cs",
                    content: settings.refund_content,
                    priority: 9,
                    status: "active"
                });
            }
        }

        // 2. Seed Products
        const { data: products } = await supabase.from("products").select("name, category, price, description").limit(20);
        if (products && products.length > 0) {
            products.forEach(p => {
                let kw = `${p.name.toLowerCase()}, ${p.category ? p.category.toLowerCase() : ''}`;
                if (p.name.toLowerCase().includes("xbox")) {
                    kw += ", gamepass, game pass, gampass, gamepas, xgp, xbox pass, ultimate";
                } else if (p.name.toLowerCase().includes("steam")) {
                    kw += ", steam wallet, voucher steam, steam code";
                }
                generatedItems.push({
                    title: `Panduan Produk: ${p.name}`,
                    category: p.category || "Produk",
                    keywords: kw,
                    content: `Produk ${p.name} tersedia di NexShop dengan harga Rp${Number(p.price).toLocaleString('id-ID')}. ${p.description || 'Pembelian otomatis instant 24/7.'}`,
                    priority: 8,
                    status: "active"
                });
            });
        }

        // 3. Seed Topup Items
        const { data: topups } = await supabase.from("topup_products").select("kategori, nama, harga_jual").eq("is_active", true).limit(20);
        if (topups && topups.length > 0) {
            const categories = Array.from(new Set(topups.map(t => t.kategori)));
            categories.forEach(cat => {
                let kw = `${cat.toLowerCase()}, topup ${cat.toLowerCase()}`;
                if (cat.toLowerCase().includes("mobile legend")) kw += ", ml, mlbb, diamond ml";
                if (cat.toLowerCase().includes("free fire")) kw += ", ff, diamond ff";
                if (cat.toLowerCase().includes("pubg")) kw += ", pubgm, uc pubg";

                generatedItems.push({
                    title: `Panduan Topup: ${cat}`,
                    category: "Topup Guide",
                    keywords: kw,
                    content: `Layanan topup instant ${cat} di NexShop. Masukkan User ID & Zone ID, pilih nominal item, dan selesaikan pembayaran. Proses otomatis 1-3 detik.`,
                    priority: 8,
                    status: "active"
                });
            });
        }

        // 4. Seed Promos
        const { data: promos } = await supabase.from("promo_codes").select("code, discount_value, description").eq("is_active", true).limit(10);
        if (promos && promos.length > 0) {
            promos.forEach(pr => {
                generatedItems.push({
                    title: `Kode Promo & Voucher: ${pr.code}`,
                    category: "Promo",
                    keywords: `${pr.code.toLowerCase()}, promo, voucher, diskon, kupon`,
                    content: `Gunakan kode promo [${pr.code}] di halaman Checkout untuk mendapatkan diskon tambahan. ${pr.description || ''}`,
                    priority: 7,
                    status: "active"
                });
            });
        }

        // Upsert to DB or Memory
        let savedCount = 0;
        try {
            const { data, error } = await supabase.from("knowledge_base").insert(generatedItems).select();
            if (!error && data) {
                savedCount = data.length;
            } else {
                inMemoryKnowledgeBase = [...generatedItems, ...inMemoryKnowledgeBase];
                savedCount = generatedItems.length;
            }
        } catch (e) {
            inMemoryKnowledgeBase = [...generatedItems, ...inMemoryKnowledgeBase];
            savedCount = generatedItems.length;
        }

        res.json({
            message: `Berhasil men-generate ${savedCount} entri Knowledge Base otomatis dari data NexShop!`,
            count: savedCount
        });
    } catch (err) {
        console.error("❌ Error reseeding knowledge base:", err);
        res.status(500).json({ message: "Gagal men-generate Knowledge Base otomatis: " + err.message });
    }
};

// Admin Controller: Auto FAQ Generator per Produk
exports.generateProductFaqs = async (req, res) => {
    try {
        const { data: products } = await supabase.from("products").select("id, name, category, price, description").limit(50);
        const faqItems = [];

        if (products && products.length > 0) {
            products.forEach(p => {
                const nameLower = p.name.toLowerCase();
                const catLower = (p.category || "").toLowerCase();

                if (nameLower.includes("xbox") || nameLower.includes("game pass") || nameLower.includes("gamepass")) {
                    faqItems.push({
                        title: `FAQ: Xbox Game Pass (${p.name})`,
                        category: "FAQ",
                        keywords: "xbox, gamepass, game pass, gampass, gamepas, xgp, xbox pass, sharing, private, ea app, ubisoft, cod, call of duty",
                        content: `Tanya Jawab ${p.name}:\n• Apakah aman? Ya, 100% legal & terjamin.\n• Apakah butuh akun sendiri? Tersedia versi Private (pakai akun sendiri) & Sharing.\n• Apakah mendukung EA Play & Ubisoft Connect? Ya, dapat memainkan EA FC, Battlefield, serta game Ubisoft di PC/Xbox.\n• Bagaimana cara aktivasi? Panduan & lisensi langsung dikirim instant setelah pembayaran.`,
                        priority: 10,
                        status: "active"
                    });
                } else if (nameLower.includes("steam")) {
                    faqItems.push({
                        title: `FAQ: Steam Wallet Code (${p.name})`,
                        category: "FAQ",
                        keywords: "steam, steam wallet, voucher steam, steam code, redeem steam, rupiah steam",
                        content: `Tanya Jawab ${p.name}:\n• Bagaimana cara redeem? Buka Steam client > Store > Redeem Wallet Code > Masukkan kode dari NexShop.\n• Apakah sesuai saldo IDR? Ya, saldo otomatis terkonversi penuh tanpa potongan.`,
                        priority: 9,
                        status: "active"
                    });
                } else {
                    faqItems.push({
                        title: `FAQ Produk: ${p.name}`,
                        category: "FAQ",
                        keywords: `${nameLower}, ${catLower}, beli ${nameLower}, garansi, stok, instant`,
                        content: `Tanya Jawab ${p.name}:\n• Berapa harganya? Harga spesial Rp${Number(p.price).toLocaleString('id-ID')}.\n• Berapa lama diproses? Proses pengiriman otomatis 1-3 detik.\n• Apakah bergaransi? Bergaransi 100% uang kembali jika terjadi kendala stok.`,
                        priority: 7,
                        status: "active"
                    });
                }
            });
        }

        // Insert into DB or In-Memory
        let createdCount = 0;
        try {
            const { data, error } = await supabase.from("knowledge_base").insert(faqItems).select();
            if (!error && data) {
                createdCount = data.length;
            } else {
                inMemoryKnowledgeBase = [...faqItems, ...inMemoryKnowledgeBase];
                createdCount = faqItems.length;
            }
        } catch (e) {
            inMemoryKnowledgeBase = [...faqItems, ...inMemoryKnowledgeBase];
            createdCount = faqItems.length;
        }

        res.json({
            message: `Berhasil men-generate ${createdCount} FAQ Produk otomatis!`,
            count: createdCount
        });
    } catch (err) {
        console.error("❌ Error generating product FAQs:", err);
        res.status(500).json({ message: "Gagal men-generate FAQ produk: " + err.message });
    }
};


