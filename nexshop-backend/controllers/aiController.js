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

// NexBot AI Intent Engine V2: Detect Intent (10 Classes)
function detectUserIntent(query) {
    const q = (query || "").toLowerCase();
    
    // 1. Comparison
    if (q.includes("beda") || q.includes("bedanya") || q.includes("perbedaan") || q.includes("vs") || q.includes("versus") || q.includes("lebih bagus") || q.includes("lebih baik") || q.includes("dibanding")) {
        return "Comparison";
    }
    // 2. Guide / How-To
    if (q.includes("cara") || q.includes("tutorial") || q.includes("langkah") || q.includes("panduan") || q.includes("aktivasi") || q.includes("redeem") || q.includes("beli") || q.includes("order") || q.includes("bagaimana") || q.includes("menggunakan")) {
        return "Guide";
    }
    // 3. Definition
    if (q.includes("apa itu") || q.includes("apa sih") || q.includes("apa fungsi") || q.includes("pengertian") || q.includes("jelaskan") || q.includes("maksud") || q.includes("apa maksud") || q.includes("itu apa") || q.includes("definisi")) {
        return "Definition";
    }
    // 4. Pricing
    if (q.includes("harga") || q.includes("berapa") || q.includes("murah") || q.includes("mahal") || q.includes("biaya")) {
        return "Pricing";
    }
    // 5. Payment
    if (q.includes("bayar") || q.includes("pembayaran") || q.includes("payment") || q.includes("qris") || q.includes("ovo") || q.includes("dana") || q.includes("gopay") || q.includes("bank") || q.includes("transfer") || q.includes("va")) {
        return "Payment";
    }
    // 6. Promo
    if (q.includes("promo") || q.includes("voucher") || q.includes("diskon") || q.includes("coupon") || q.includes("kode promo")) {
        return "Promo";
    }
    // 7. Refund
    if (q.includes("refund") || q.includes("cancel") || q.includes("batal") || q.includes("uang kembali") || q.includes("garansi")) {
        return "Refund";
    }
    // 8. Order Status
    if (q.includes("status") || q.includes("pesanan") || q.includes("order") || q.includes("tracking") || q.includes("diproses") || q.includes("belum masuk")) {
        return "OrderStatus";
    }
    // 9. Product Recommendation
    if (q.includes("rekomendasi") || q.includes("cocok") || q.includes("saran") || q.includes("bagus mana")) {
        return "ProductRecommendation";
    }
    // 10. Technical Support
    if (q.includes("error") || q.includes("bug") || q.includes("login") || q.includes("otp") || q.includes("gagal") || q.includes("tidak bisa") || q.includes("masalah")) {
        return "TechnicalSupport";
    }

    return "General";
}

// Entity Detection Helper
function detectEntity(query) {
    const q = (query || "").toLowerCase();
    const entities = [];

    if (q.includes("sharing") || q.includes("shared")) entities.push("sharing");
    if (q.includes("private") || q.includes("personal")) entities.push("private");
    if (q.includes("xbox") || q.includes("gamepass") || q.includes("game pass") || q.includes("gampass") || q.includes("gamepas") || q.includes("xgp") || q.includes("gp")) entities.push("gamepass");
    if (q.includes("steam") || q.includes("wallet")) entities.push("steam");
    if (q.includes("ml") || q.includes("mlbb") || q.includes("mobile legend")) entities.push("mobile_legends");
    if (q.includes("ff") || q.includes("free fire")) entities.push("free_fire");
    if (q.includes("pubg") || q.includes("pubgm")) entities.push("pubg");
    if (q.includes("valorant") || q.includes("val")) entities.push("valorant");
    if (q.includes("genshin") || q.includes("gi")) entities.push("genshin");

    return entities;
}

// Scoring Calibrated to Weights: Intent 40%, Entity 30%, Title 15%, Keyword 10%, Content 5%
function calculateKnowledgeScore(item, query, expandedTerms, intent, entities = []) {
    let score = 0;
    const titleLower = (item.title || "").toLowerCase();
    const keywordsLower = (item.keywords || "").toLowerCase();
    const catLower = (item.category || "").toLowerCase();
    const contentLower = (item.content || "").toLowerCase();

    // Tentukan inherent intent dari Knowledge item
    let itemIntent = "General";
    if (titleLower.includes("cara") || titleLower.includes("panduan") || titleLower.includes("langkah") || titleLower.includes("tutorial") || titleLower.includes("membeli") || catLower.includes("guide")) {
        itemIntent = "Guide";
    } else if (titleLower.includes("apa itu") || titleLower.includes("pengertian") || titleLower.includes("definisi") || titleLower.includes("faq")) {
        itemIntent = "Definition";
    } else if (titleLower.includes("perbedaan") || titleLower.includes("versus") || titleLower.includes("vs") || titleLower.includes("sharing vs private")) {
        itemIntent = "Comparison";
    } else if (titleLower.includes("pembayaran") || titleLower.includes("qris") || catLower.includes("payment")) {
        itemIntent = "Payment";
    } else if (titleLower.includes("refund") || titleLower.includes("garansi") || catLower.includes("policy")) {
        itemIntent = "Refund";
    }

    // 1. Intent Match (40%)
    if (intent === itemIntent) {
        score += 40;
    } else if (intent === "Guide" && itemIntent === "Definition") {
        // PENALTI KERAS: User minta CARA BELI, DILARANG ambil DEFINISI!
        score -= 60;
    } else if (intent === "Definition" && itemIntent === "Guide") {
        // PENALTI KERAS: User minta DEFINISI, DILARANG ambil CARA BELI!
        score -= 60;
    }

    // 2. Entity Match (30%)
    entities.forEach(ent => {
        if (titleLower.includes(ent) || keywordsLower.includes(ent) || contentLower.includes(ent)) {
            score += 30;
        }
    });

    // 3. Title Exact / Partial Match (15%)
    expandedTerms.forEach(term => {
        if (term && titleLower.includes(term)) score += 15;
    });

    // 4. Keyword Match (10%)
    expandedTerms.forEach(term => {
        if (term && keywordsLower.includes(term)) score += 10;
    });

    // 5. Content Semantic Match (5%)
    expandedTerms.forEach(term => {
        if (term && contentLower.includes(term)) score += 5;
    });

    return score;
}

// RAG (Retrieval-Augmented Generation) Helper: Cari konteks relevan di DB lokal secara real-time
async function retrieveContext(query, user) {
    const { raw: qLower, expandedTerms } = normalizeAndExpandQuery(query);
    const intent = detectUserIntent(query);
    const entities = detectEntity(query);
    const contextLines = [];
    const suggestedCards = [];

    console.log(`\n======================================================`);
    console.log(`🔍 [RAG AUDIT LOG] PIPELINE RETRIEVAL STARTED`);
    console.log(`• Raw Query   : "${query}"`);
    console.log(`• Normalized  : "${qLower}"`);
    console.log(`• Expanded    : [${expandedTerms.join(", ")}]`);
    console.log(`• Intent      : ${intent}`);
    console.log(`• Entities    : [${entities.join(", ")}]`);
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
        
        // Hitung skor berbobot & rangking seluruh kandidat berdasarkan Intent & Entity V2
        const scoredKb = activeKbList.map(k => ({
            ...k,
            score: calculateKnowledgeScore(k, query, expandedTerms, intent, entities)
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
            score: calculateKnowledgeScore(k, query, expandedTerms, intent, entities)
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

// Formatter Balasan Customer Service Profesional (Zero AI / Database Meta References)
function formatCustomerServiceResponse(rawText, userName = "") {
    if (!rawText) return "";

    let text = String(rawText);

    // 1. Hapus istilah AI, Knowledge Base, Database, dan Meta References
    text = text.replace(/Berikut informasi resmi dari Knowledge Base NexShop[^\n]*/gi, "");
    text = text.replace(/Berikut informasi resmi dari Knowledge Base[^\n]*/gi, "");
    text = text.replace(/Knowledge Base NexShop/gi, "NexShop");
    text = text.replace(/Knowledge Base/gi, "");
    text = text.replace(/Database NexShop/gi, "NexShop");
    text = text.replace(/Database/gi, "");
    text = text.replace(/AI Reference/gi, "");
    text = text.replace(/System Context[^\n]*/gi, "");
    text = text.replace(/FAQ:\s*/gi, "");
    text = text.replace(/Panduan Produk:\s*/gi, "");
    text = text.replace(/📌/g, "");
    text = text.replace(/🤖/g, "");
    text = text.replace(/\[FAQ\]/g, "");
    text = text.replace(/\[Store Info\]/g, "");
    text = text.replace(/\[Policy\]/g, "");
    text = text.replace(/\[Payment Method\]/g, "");

    // 2. Bersihkan karakter escape & spasi berlebih
    text = text.replace(/\\n/g, "\n");
    text = text.replace(/\\r/g, "");
    text = text.replace(/\\t/g, " ");

    // Hapus tanda bintang Markdown ganda jika ada yang mengganggu
    text = text.replace(/\*\*(.*?)\*\*/g, "$1");

    let cleanLines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);
    let bodyText = cleanLines.join("\n\n");

    // 3. Format Pembuka & Penutup Ramah Khas CS
    let greeting = userName ? `Halo ${userName}! 👋\n\n` : `Halo! 👋\n\n`;
    if (bodyText.toLowerCase().startsWith("halo") || bodyText.toLowerCase().startsWith("hai")) {
        greeting = "";
    }

    let closing = "\n\nJika ada hal lain yang ingin ditanyakan seputar produk NexShop, silakan tanyakan kapan saja ya! 😊";
    if (bodyText.includes("ditanyakan") || bodyText.includes("membantu") || bodyText.includes("😊")) {
        closing = "";
    }

    return (greeting + bodyText + closing).trim();
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
        const systemPrompt = `Kamu adalah NexBot — Customer Service Resmi NexShop.

ATURAN UTAMA CS PROFESIONAL:
1. JAWAB SEPERTI CUSTOMER SERVICE HUMANIS, RAMAH, DAN PROFESIONAL.
2. DILARANG MENGGUNAKAN KATA "Knowledge Base", "Database", "AI", ATAU "Context".
3. DILARANG MERANGKUM ATAU MENGUBAH FAKTA DARI KONTEKS NEXSHOP.
4. JIKA KNOWLEDGE TIDAK TERSEDIA, SAMPAIKAN BAHWA INFORMASI BELUM TERSEDIA DENGAN SOPAN.
${userName ? `5. SAPA PENGGUNA TERLEBIH DAHULU: "Halo ${userName}! 👋"` : ""}

KONTEKS INFORMASI NEXSHOP:
${contextText || "Belum ada konteks khusus."}`;

        console.log(`🤖 [RAG AUDIT LOG] PROMPT AUDIT & TOKEN ESTIMATION:`);
        console.log(`• System Prompt Length: ${systemPrompt.length} chars (~${Math.ceil(systemPrompt.length / 4)} tokens)`);
        console.log(`• User Message Length : ${q.length} chars (~${Math.ceil(q.length / 4)} tokens)`);
        console.log(`• Total Token Est.    : ~${Math.ceil((systemPrompt.length + q.length) / 4)} tokens`);

        let finalReplyText = "";
        let isHandoff = false;

        // ⚡ RULE ENGINE: Jika Similarity / Score >= 90 (High Match), Render CS Response LANGSUNG tanpa panggil Gemini!
        if (maxScore >= 90 && topKbItems && topKbItems.length > 0) {
            console.log(`⚡ [RULE ENGINE] High Match (Score ${maxScore} >= 90). Rendering CS response DIRECTLY!`);
            let kbRaw = topKbItems.map(k => {
                const titleClean = (k.title || "").replace(/^FAQ:\s*/i, "").replace(/^Panduan Produk:\s*/i, "").replace(/📌/g, "").trim();
                return `${titleClean}\n\n${k.content}`;
            }).join("\n\n");
            finalReplyText = formatCustomerServiceResponse(kbRaw, userName);
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

                    const rawGeminiResp = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
                    if (rawGeminiResp) {
                        finalReplyText = formatCustomerServiceResponse(rawGeminiResp, userName);
                        const respTokensEst = Math.ceil(finalReplyText.length / 4);
                        console.log(`✨ [RAG AUDIT LOG] GEMINI RESPONSE RECEIVED SUCCESS (HTTP ${response.status}, ${finalReplyText.length} chars, ~${respTokensEst} output tokens).`);
                    }
                } catch (geminiErr) {
                    const httpStatus = geminiErr.response ? geminiErr.response.status : "NO_STATUS";
                    const errorBody = geminiErr.response ? JSON.stringify(geminiErr.response.data) : geminiErr.message;
                    console.error(`❌ [GEMINI AUDIT ERROR] HTTP Status: ${httpStatus}`);
                    console.error(`❌ [GEMINI AUDIT ERROR] Full Error Body:`, errorBody);
                    console.log("⚠️ Call Gemini API gagal, beralih ke Direct CS RAG Renderer!");
                }
            }
        }

        // 🛡️ CRITICAL RAG FALLBACK RENDERER: Jika Gemini gagal tetapi KB ditemukan, render sebagai CS balasan langsung
        if (!finalReplyText && topKbItems && topKbItems.length > 0) {
            console.log(`🛡️ [RAG FALLBACK RENDERER] Gemini offline/429. Rendering ${topKbItems.length} Knowledge Base items directly...`);
            let kbRaw = topKbItems.map(k => {
                const titleClean = (k.title || "").replace(/^FAQ:\s*/i, "").replace(/^Panduan Produk:\s*/i, "").replace(/📌/g, "").trim();
                return `${titleClean}\n\n${k.content}`;
            }).join("\n\n");
            finalReplyText = formatCustomerServiceResponse(kbRaw, userName);
        }

        // Fallback CS ramah jika informasi tidak ditemukan
        if (!finalReplyText) {
            isHandoff = true;
            let fallbackText = userName ? `Halo ${userName}! 👋\n\n` : `Halo! 👋\n\n`;
            fallbackText += "Mohon maaf, informasi mengenai hal tersebut belum tersedia saat ini. Silakan hubungi Tim Customer Service kami via WhatsApp di 6287792634063 untuk bantuan lebih lanjut ya! 😊";
            finalReplyText = fallbackText;
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


