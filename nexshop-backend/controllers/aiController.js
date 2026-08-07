"use strict";

const axios = require("axios");
const { getStoreSettings, getApiKeys, DEFAULT_GEMINI_MODEL, callGeminiWithFallback } = require("../config/settings");
const { normalizeQuery, detectIntent, detectEntities, rankKnowledge, buildKnowledgeResponse } = require("../utils/nexbotEngine");
const aiProviderManager = require("../services/aiProviderManager");
const supabase = require("../config/db");

function maskKey(value) {
    return aiProviderManager.maskKey(value);
}

// Shared AI calls route through aiProviderManager.

async function logGeminiRequest({ userMessage, modelUsed, responseTimeMs, tokenUsage, httpStatus, isSuccess, errorMessage, userId, sessionId }) {
    const payload = {
        user_message: safeMessage(userMessage),
        model_used: modelUsed || "gemini-2.5-flash",
        response_time_ms: Math.round(responseTimeMs || 0),
        token_usage: tokenUsage || null,
        http_status: Number(httpStatus || 200),
        is_success: !!isSuccess,
        error_message: errorMessage ? String(errorMessage).slice(0, 1000) : null,
        user_id: userId ? String(userId) : null,
        session_id: sessionId || null
    };
    try {
        await supabase.from("ai_gemini_logs").insert(payload);
    } catch (err) {
        console.warn("Gemini log insert warning:", err.message);
    }
}

// This is deliberately small. It makes the public assistant safe during a
// migration, but it is not a writable pseudo-database: admin changes must be
// persisted in Supabase or fail visibly.
const BUILTIN_KNOWLEDGE = [
    { id: "builtin-payment", title: "Metode Pembayaran", category: "Payment", keywords: "bayar pembayaran qris dana ovo gopay transfer bank va", content: "NexShop mendukung QRIS, e-wallet, Virtual Account bank, transfer bank, dan kartu kredit. Pilihan yang tersedia akan tampil saat Checkout.", priority: 5, status: "active" },
    { id: "builtin-topup", title: "Cara Topup Diamond", category: "Guide", keywords: "cara topup diamond ml mlbb mobile legends free fire pubg", content: "Buka menu Topup, pilih game, masukkan User ID dan Zone ID bila diminta, pilih nominal, lalu selesaikan pembayaran. Pesanan diproses otomatis setelah pembayaran terkonfirmasi.", priority: 5, status: "active" },
    { id: "builtin-refund", title: "Kebijakan Refund", category: "Policy", keywords: "refund pengembalian dana batal garansi", content: "Untuk kendala saldo atau item yang tidak masuk, siapkan Nomor Order ID dan hubungi Customer Service NexShop agar pesanan dapat diperiksa.", priority: 5, status: "active" }
];

const QUICK_ACTIONS = {
    topup: "Cara Topup ML",
    promo: "Promo Hari Ini",
    order: "Status Pesanan Saya",
    faq: "FAQ NexShop"
};

function safeSessionId(value) {
    const fallback = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return typeof value === "string" && /^[a-zA-Z0-9_-]{8,100}$/.test(value) ? value : fallback;
}

function safeMessage(value) {
    return typeof value === "string" ? value.trim().slice(0, 2000) : "";
}

function knowledgeColumns() {
    return "id,title,category,keywords,content,status,priority,updated_at";
}

async function loadKnowledge(query) {
    // The SQL RPC uses PostgreSQL full-text + pg_trgm as a candidate generator.
    // A normal select remains compatible while an existing installation applies
    // the migration for the first time; final ranking is always deterministic.
    try {
        const rpc = await supabase.rpc("search_nexbot_knowledge", { search_query: query.raw, result_limit: 80 });
        if (!rpc.error && Array.isArray(rpc.data) && rpc.data.length) return rpc.data;
    } catch (_) { /* fall through to the compatible query */ }
    const { data, error } = await supabase.from("knowledge_base").select(knowledgeColumns()).eq("status", "active").order("priority", { ascending: false }).limit(250);
    if (error) return BUILTIN_KNOWLEDGE;
    return data?.length ? data : BUILTIN_KNOWLEDGE;
}

async function loadConversationMemory(sessionId, userId) {
    const filters = supabase.from("ai_conversations").select("role,message,intent,created_at").eq("session_id", sessionId).order("created_at", { ascending: false }).limit(6);
    const [conversationResult, userResult] = await Promise.allSettled([
        filters,
        userId ? supabase.from("ai_user_memories").select("favorite_game,custom_preferences").eq("user_id", String(userId)).maybeSingle() : Promise.resolve({ data: null })
    ]);
    const conversation = conversationResult.status === "fulfilled" && !conversationResult.value.error ? (conversationResult.value.data || []).reverse() : [];
    const userMemory = userResult.status === "fulfilled" && !userResult.value.error ? userResult.value.data : null;
    return { conversation, userMemory };
}

function memoryEntities(query, memory) {
    if (detectEntities(query).length || !memory.conversation.length) return [];
    const recentCustomerMessage = [...memory.conversation].reverse().find((item) => item.role === "user")?.message || "";
    const favorite = memory.userMemory?.favorite_game || "";
    return detectEntities(normalizeQuery(`${recentCustomerMessage} ${favorite}`));
}

async function retrieveKnowledge(message, sessionId, user) {
    const query = normalizeQuery(message);
    const intent = detectIntent(query);
    const memory = await loadConversationMemory(sessionId, user?.id);
    const entities = [...new Set([...detectEntities(query), ...memoryEntities(query, memory)])];
    const knowledge = await loadKnowledge(query);
    const selected = rankKnowledge(knowledge, query, intent, entities);
    return { query, intent, entities, memory, selected };
}

async function saveConversation({ userId, sessionId, role, message, intent, knowledgeIds }) {
    const payload = {
        user_id: userId ? String(userId) : null,
        session_id: sessionId,
        role,
        message: safeMessage(message),
        intent,
        knowledge_ids: knowledgeIds || []
    };
    try { await supabase.from("ai_conversations").insert(payload); } catch (_) { /* analytics/memory must never break chat */ }
}

async function updateUserMemory(user, query, intent, entities) {
    if (!user?.id) return;
    const favoriteGame = entities.find((entity) => /Mobile Legends|Free Fire|PUBG|Valorant|Xbox|Steam|Nintendo|PlayStation/.test(entity)) || null;
    const payload = {
        user_id: String(user.id),
        favorite_game: favoriteGame,
        custom_preferences: { last_query: query.raw, last_intent: intent, last_entities: entities },
        last_seen_at: new Date().toISOString()
    };
    try { await supabase.from("ai_user_memories").upsert(payload, { onConflict: "user_id" }); } catch (_) { /* optional personalization */ }
}

async function saveAnalytics({ query, intent, entities, selected, source, failed, user, sessionId }) {
    const payload = {
        normalized_query: query.raw,
        intent,
        entities,
        knowledge_ids: selected.map((item) => String(item.id)),
        response_source: source,
        is_failed: failed,
        user_id: user?.id ? String(user.id) : null,
        session_id: sessionId
    };
    try { await supabase.from("ai_query_analytics").insert(payload); } catch (_) { /* analytics is non-blocking */ }
}

function unavailableReply() {
    return "Maaf, informasi untuk pertanyaan tersebut belum tersedia. Agar kami dapat membantu dengan tepat, silakan hubungi Customer Service NexShop dengan detail pertanyaan atau Nomor Order ID Anda.";
}

async function handleOrderLookup(message, user) {
    const rawMsg = String(message || "").trim();

    // 1. Cek apakah ada Order ID (contoh: NX123... atau TP123...)
    const orderIdMatch = rawMsg.match(/\b(NX[A-F0-9]{10,30}|TP[A-F0-9]{10,30})\b/i);
    if (orderIdMatch) {
        const orderId = orderIdMatch[1].toUpperCase();

        const { data: regularOrder } = await supabase
            .from("orders")
            .select("id, status, total, items, created_at, paid_at")
            .eq("id", orderId)
            .maybeSingle();

        if (regularOrder) {
            const statusLabel = regularOrder.status === "paid" ? "✅ Berhasil (Lunas)" : regularOrder.status === "pending" ? "⏳ Menunggu Pembayaran" : "❌ Gagal / Batal";
            const itemsSummary = (regularOrder.items || []).map(i => `• ${i.name || 'Produk'} (x${i.qty || 1})`).join("\n");
            return `📦 **Detail Pesanan ${regularOrder.id}**\n\nStatus: **${statusLabel}**\nTotal: **Rp${Number(regularOrder.total || 0).toLocaleString("id-ID")}**\nTanggal: ${new Date(regularOrder.created_at).toLocaleString("id-ID")}\n\n**Item:**\n${itemsSummary}`;
        }

        const { data: topupOrder } = await supabase
            .from("topup_orders")
            .select("id, status, harga, nama_produk, tujuan, server_id, created_at")
            .eq("id", orderId)
            .maybeSingle();

        if (topupOrder) {
            const statusLabel = (topupOrder.status === "sukses" || topupOrder.status === "paid") ? "✅ Berhasil (Sukses)" : topupOrder.status === "pending" ? "⏳ Menunggu Pembayaran / Diproses" : "❌ Gagal";
            const targetInfo = topupOrder.tujuan + (topupOrder.server_id ? ` (${topupOrder.server_id})` : "");
            return `💎 **Detail Topup ${topupOrder.id}**\n\nProduk: **${topupOrder.nama_produk || '-'}**\nTujuan: **${targetInfo}**\nStatus: **${statusLabel}**\nTotal: **Rp${Number(topupOrder.harga || 0).toLocaleString("id-ID")}**\nTanggal: ${new Date(topupOrder.created_at).toLocaleString("id-ID")}`;
        }

        return `Nomor Order ID **${orderId}** tidak ditemukan di sistem NexShop. Mohon periksa kembali nomor order Anda atau hubungi CS WhatsApp jika membutuhkan bantuan.`;
    }

    // 2. Cek apakah ada alamat Email di dalam pesan
    const emailMatch = rawMsg.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    if (emailMatch) {
        const email = emailMatch[1].toLowerCase();
        const [ordersRes, topupRes] = await Promise.all([
            supabase.from("orders").select("id, status, total, items, created_at").eq("recipient_email", email).order("created_at", { ascending: false }).limit(3),
            supabase.from("topup_orders").select("id, status, harga, nama_produk, created_at").eq("recipient_email", email).order("created_at", { ascending: false }).limit(3)
        ]);

        const regList = (ordersRes.data || []).map(o => ({ id: o.id, title: (o.items || []).map(i => i.name).join(", ") || "Pesanan Produk", total: o.total, status: o.status, date: o.created_at }));
        const topList = (topupRes.data || []).map(t => ({ id: t.id, title: t.nama_produk || "Topup Game", total: t.harga, status: t.status, date: t.created_at }));
        const combined = [...regList, ...topList].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 3);

        if (combined.length) {
            const listText = combined.map(item => `• **${item.id}** — ${item.title}\n  Total: Rp${Number(item.total).toLocaleString("id-ID")} | Status: **${item.status}**`).join("\n\n");
            return `📋 **Riwayat Pesanan untuk ${email}:**\n\n${listText}`;
        }

        return `Tidak ditemukan pesanan dengan email **${email}**. Mohon pastikan alamat email yang Anda masukkan sesuai dengan saat checkout.`;
    }

    // 3. Jika user sedang terautentikasi (login)
    if (user?.id) {
        const [ordersRes, topupRes] = await Promise.all([
            supabase.from("orders").select("id, status, total, items, created_at").eq("user_id", String(user.id)).order("created_at", { ascending: false }).limit(3),
            supabase.from("topup_orders").select("id, status, harga, nama_produk, created_at").eq("user_id", String(user.id)).order("created_at", { ascending: false }).limit(3)
        ]);

        const regList = (ordersRes.data || []).map(o => ({ id: o.id, title: (o.items || []).map(i => i.name).join(", ") || "Pesanan Produk", total: o.total, status: o.status, date: o.created_at }));
        const topList = (topupRes.data || []).map(t => ({ id: t.id, title: t.nama_produk || "Topup Game", total: t.harga, status: t.status, date: t.created_at }));
        const combined = [...regList, ...topList].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 3);

        if (combined.length) {
            const listText = combined.map(item => `• **${item.id}** — ${item.title}\n  Total: Rp${Number(item.total).toLocaleString("id-ID")} | Status: **${item.status}**`).join("\n\n");
            return `📦 **Status Pesanan Terbaru Anda:**\n\n${listText}\n\nKetik Nomor Order ID spesifik untuk detail lengkap.`;
        }

        return `Akun Anda belum memiliki riwayat transaksi di NexShop. Jika Anda melakukan pemesanan tanpa login (Guest Checkout), silakan kirimkan **Nomor Order ID** (contoh: \`NX...\` atau \`TP...\`) atau alamat **Email** transaksi Anda.`;
    }

    // 4. Guest user tanpa Order ID / Email di pesan
    return `Untuk mengecek **Status Pesanan Saya**, silakan kirimkan **Nomor Order ID** Anda (contoh: \`NX...\` atau \`TP...\`), atau alamat **Email** yang Anda gunakan saat bertransaksi.\n\nAnda juga dapat mengecek status pesanan secara langsung melalui menu **Cek Transaksi** pada bagian atas website atau menghubungi CS WhatsApp kami.`;
}

async function answer(message, sessionId, user) {
    const result = await retrieveKnowledge(message, sessionId, user);

    let reply = "";
    let source = "knowledge";
    const isOrderQuery = result.intent === "Order" || /\b(NX[A-F0-9]{10,30}|TP[A-F0-9]{10,30})\b/i.test(message) || /status pesanan|lacak|pesanan saya/i.test(message);

    if (isOrderQuery) {
        reply = await handleOrderLookup(message, user);
        source = "order_system";
    } else {
        const knowledgeText = result.selected.length ? buildKnowledgeResponse(result.selected) : "Belum ada informasi khusus untuk pertanyaan ini.";
        const systemPrompt = `Kamu adalah NexBot, asisten AI resmi dari toko game & e-commerce NexShop.
Tugas kamu adalah menjawab pertanyaan pelanggan secara ramah, profesional, dan membantu dalam bahasa Indonesia.
Gunakan FAKTA KNOWLEDGE BASE NEXSHOP di bawah ini sebagai sumber kebenaran utama:

--- FAKTA KNOWLEDGE BASE ---
${knowledgeText}
----------------------------

Aturan menjawab:
1. Jawab pertanyaan user berdasarkan Fakta Knowledge Base jika relevan.
2. Jangan mengarang kebijakan pembayaran, cara topup, atau harga yang bertentangan dengan fakta di atas.
3. Jawab singkat, jelas, dan ramah dengan format markdown yang rapi.`;

        const aiRes = await aiProviderManager.generateResponse({
            prompt: message,
            systemPrompt,
            userId: user?.id,
            sessionId
        });

        if (aiRes.success && aiRes.reply) {
            reply = aiRes.reply;
            source = aiRes.provider; // e.g. "gemini", "groq", "openrouter"
        } else {
            console.error("❌ AI Provider Manager failed for prompt:", message);
            console.error("   Error details:", aiRes.error);
            if (process.env.NODE_ENV !== "production") {
                reply = `[Dev Mode AI Error]: ${aiRes.error || "Semua AI Provider gagal merespons"}`;
            } else {
                reply = result.selected.length ? buildKnowledgeResponse(result.selected) : unavailableReply();
            }
            source = result.selected.length ? "knowledge" : "handoff";
        }
    }

    const knowledgeIds = result.selected.map((item) => String(item.id));
    await Promise.allSettled([
        saveConversation({ userId: user?.id, sessionId, role: "user", message, intent: result.intent, knowledgeIds }),
        saveConversation({ userId: user?.id, sessionId, role: "assistant", message: reply, intent: result.intent, knowledgeIds }),
        updateUserMemory(user, result.query, result.intent, result.entities),
        saveAnalytics({ ...result, source, failed: !result.selected.length && source !== "order_system" && !["gemini", "groq", "openrouter"].includes(source), user, sessionId })
    ]);
    return { reply, source, handoff: source === "handoff", intent: result.intent, entities: result.entities, knowledgeIds };
}

exports.chat = async (req, res) => {
    const message = safeMessage(req.body.message);
    if (!message) return res.status(400).json({ message: "Pesan tidak boleh kosong" });
    const sessionId = safeSessionId(req.body.session_id || req.headers["x-session-id"]);
    try {
        const result = await answer(message, sessionId, req.user || null);
        return res.json({ reply: result.reply, session_id: sessionId, handoff: result.handoff, source: result.source, intent: result.intent, knowledge_ids: result.knowledgeIds });
    } catch (error) {
        console.error("❌ NexBot chat error stack:", error.stack || error);
        const errorMessage = process.env.NODE_ENV !== "production"
            ? `NexBot Error: ${error.message}`
            : "NexBot sedang mengalami kendala. Silakan coba lagi.";
        return res.status(500).json({ message: errorMessage, error: error.message });
    }
};

// Quick actions use exactly the same retrieval and direct knowledge renderer,
// but never invoke an LLM. This also makes their latency predictable.
exports.quickAction = async (req, res) => {
    const action = String(req.params.action || "").toLowerCase();
    const message = QUICK_ACTIONS[action];
    if (!message) return res.status(404).json({ message: "Quick action tidak ditemukan" });
    const sessionId = safeSessionId(req.headers["x-session-id"]);
    try {
        const result = await answer(message, sessionId, req.user || null);
        return res.json({ ...result, session_id: sessionId });
    } catch (error) {
        console.error("NexBot quick action error:", error.message);
        return res.status(500).json({ message: "Quick action sedang mengalami kendala" });
    }
};

exports.getKnowledgeBase = async (_req, res) => {
    const { data, error } = await supabase.from("knowledge_base").select("*").order("priority", { ascending: false });
    if (error) return res.status(503).json({ message: "Knowledge Base belum tersedia. Jalankan migrasi NexBot terlebih dahulu." });
    return res.json({ data: data || [] });
};

function knowledgePayload(body, partial = false) {
    const value = {};
    ["title", "category", "keywords", "content"].forEach((key) => {
        if (body[key] !== undefined) value[key] = String(body[key]).trim();
    });
    if (body.status !== undefined) value.status = ["active", "inactive", "draft"].includes(body.status) ? body.status : "draft";
    if (body.priority !== undefined) value.priority = Math.max(0, Math.min(100, Number(body.priority) || 0));
    if (!partial && (!value.title || !value.content)) return null;
    return value;
}

exports.createKnowledgeBase = async (req, res) => {
    const payload = knowledgePayload(req.body);
    if (!payload) return res.status(400).json({ message: "Judul dan konten wajib diisi" });
    const { data, error } = await supabase.from("knowledge_base").insert(payload).select().single();
    if (error) return res.status(503).json({ message: "Gagal menyimpan knowledge", detail: error.message });
    return res.status(201).json({ message: "Knowledge berhasil ditambahkan", data });
};

function isValidUuid(value) {
    return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

exports.updateKnowledgeBase = async (req, res) => {
    if (!isValidUuid(req.params.id)) {
        return res.status(400).json({ message: "ID Knowledge Base tidak valid" });
    }
    const payload = knowledgePayload(req.body, true);
    if (!Object.keys(payload).length) return res.status(400).json({ message: "Tidak ada perubahan valid" });
    const { data, error } = await supabase.from("knowledge_base").update(payload).eq("id", req.params.id).select().maybeSingle();
    if (error) return res.status(503).json({ message: "Gagal memperbarui knowledge", detail: error.message });
    if (!data) return res.status(404).json({ message: "Knowledge tidak ditemukan" });
    return res.json({ message: "Knowledge berhasil diperbarui", data });
};

exports.deleteKnowledgeBase = async (req, res) => {
    if (!isValidUuid(req.params.id)) {
        return res.status(400).json({ message: "ID Knowledge Base tidak valid" });
    }
    const { data, error } = await supabase.from("knowledge_base").delete().eq("id", req.params.id).select("id").maybeSingle();
    if (error) return res.status(503).json({ message: "Gagal menghapus knowledge", detail: error.message });
    if (!data) return res.status(404).json({ message: "Knowledge tidak ditemukan" });
    return res.json({ message: "Knowledge berhasil dihapus" });
};

// Rebuild only stable store facts. Existing knowledge is preserved so manually
// authored, product-specific facts cannot be overwritten by an AI generator.
exports.reseedKnowledgeBase = async (_req, res) => {
    try {
        const settings = await getStoreSettings({ fresh: true });
        const generated = BUILTIN_KNOWLEDGE.map(({ id, ...item }) => item);
        if (settings.refund_content) generated.push({ title: "Kebijakan Refund NexShop", category: "Policy", keywords: "refund pengembalian dana garansi komplain", content: String(settings.refund_content), priority: 10, status: "active" });
        const { data, error } = await supabase.from("knowledge_base").upsert(generated, { onConflict: "title" }).select();
        if (error) return res.status(503).json({ message: "Gagal membangun knowledge", detail: error.message });
        return res.json({ message: "Knowledge resmi berhasil diperbarui", count: data?.length || 0 });
    } catch (error) { return res.status(500).json({ message: "Gagal membangun knowledge" }); }
};

exports.generateProductFaqs = async (_req, res) => res.status(410).json({ message: "Generator FAQ otomatis dinonaktifkan untuk menjaga fakta knowledge. Tambahkan knowledge produk melalui dashboard." });

exports.getAnalytics = async (_req, res) => {
    const { data, error } = await supabase.from("ai_query_analytics").select("normalized_query,intent,knowledge_ids,is_failed,created_at").order("created_at", { ascending: false }).limit(1000);
    if (error) return res.status(503).json({ message: "Analitik NexBot belum tersedia. Jalankan migrasi NexBot terlebih dahulu." });
    const rows = data || []; const countBy = (key) => Object.entries(rows.reduce((acc, row) => { const value = row[key] || "Tidak diketahui"; acc[value] = (acc[value] || 0) + 1; return acc; }, {})).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 10);
    const missing = rows.filter((row) => row.is_failed).reduce((acc, row) => { acc[row.normalized_query] = (acc[row.normalized_query] || 0) + 1; return acc; }, {});
    return res.json({ total_questions: rows.length, failed_questions: rows.filter((row) => row.is_failed).length, popular_questions: countBy("normalized_query"), intents: countBy("intent"), missing_knowledge: Object.entries(missing).map(([query, count]) => ({ query, count, recommendation: `Tambahkan knowledge untuk: ${query}` })).sort((a, b) => b.count - a.count).slice(0, 10) });
};

exports.testGeminiConnection = async (req, res) => {
    try {
        const result = await aiProviderManager.testSingleProvider("gemini", req.user?.id);
        return res.status(result.success ? 200 : (result.httpStatus || 500)).json(result);
    } catch (err) {
        return res.status(500).json({ success: false, connected: false, message: err.message || "Gagal melakukan uji koneksi Gemini" });
    }
};

exports.getGeminiStatus = async (_req, res) => {
    try {
        const keys = await getApiKeys();
        const apiKey = keys.gemini_api_key || process.env.GEMINI_API_KEY || "";
        const preferredModel = keys.gemini_news_model || DEFAULT_GEMINI_MODEL;

        const { data: logs, error } = await supabase
            .from("ai_gemini_logs")
            .select("is_success, response_time_ms, http_status, error_message, model_used, created_at")
            .order("created_at", { ascending: false })
            .limit(500);

        if (error) {
            console.warn("Error fetching ai_gemini_logs:", error.message);
        }

        const rows = logs || [];
        const totalRequests = rows.length;
        const successfulRequests = rows.filter((r) => r.is_success).length;
        const failedRequests = totalRequests - successfulRequests;
        const successRate = totalRequests > 0 ? Number(((successfulRequests / totalRequests) * 100).toFixed(1)) : 100.0;

        const lastSuccess = rows.find((r) => r.is_success)?.created_at || null;
        const lastFailed = rows.find((r) => !r.is_success);
        const lastFailedAt = lastFailed?.created_at || null;
        const lastError = lastFailed?.error_message || null;

        const validLatencies = rows.map((r) => r.response_time_ms).filter((t) => Number.isInteger(t) && t > 0);
        const avgLatencyMs = validLatencies.length ? Math.round(validLatencies.reduce((a, b) => a + b, 0) / validLatencies.length) : 0;

        const isConnected = !!apiKey && (totalRequests === 0 || (rows[0] && rows[0].is_success));
        const activeModel = rows[0]?.model_used || preferredModel;

        return res.json({
            connected: isConnected,
            has_api_key: !!apiKey,
            model: activeModel,
            masked_key: maskKey(apiKey),
            total_requests: totalRequests,
            successful_requests: successfulRequests,
            failed_requests: failedRequests,
            success_rate: successRate,
            last_successful_request: lastSuccess,
            last_failed_request: lastFailedAt,
            last_error: lastError,
            avg_response_time_ms: avgLatencyMs
        });
    } catch (err) {
        return res.status(500).json({ message: "Gagal mengambil status Gemini AI" });
    }
};

exports.getGeminiLogs = async (_req, res) => {
    try {
        const { data, error } = await supabase
            .from("ai_gemini_logs")
            .select("*")
            .order("created_at", { ascending: false })
            .limit(100);

        if (error) {
            return res.status(503).json({ message: "Tabel log Gemini belum tersedia. Jalankan migrations-22-gemini-monitoring.sql di Supabase." });
        }

        return res.json({ data: data || [] });
    } catch (err) {
        return res.status(500).json({ message: "Gagal mengambil log Gemini AI" });
    }
};

// ===================================
// MULTI-AI PROVIDER ADMIN HANDLERS
// ===================================

exports.getAdminAiStatus = async (_req, res) => {
    try {
        const status = await aiProviderManager.getOverallStatus();
        return res.json(status);
    } catch (err) {
        return res.status(500).json({ message: "Gagal mengambil status AI Provider", detail: err.message });
    }
};

exports.getAdminAiLogs = async (req, res) => {
    try {
        const { provider, status, date, limit } = req.query;
        const logs = await aiProviderManager.getFilteredLogs({
            provider: provider || "all",
            status: status || "all",
            date: date || null,
            limit: Math.min(200, Number(limit) || 100)
        });
        return res.json({ data: logs });
    } catch (err) {
        return res.status(500).json({ message: "Gagal mengambil log AI Provider", detail: err.message });
    }
};

exports.testAdminAiProviders = async (req, res) => {
    try {
        const { provider_id } = req.body || {};
        if (provider_id) {
            const result = await aiProviderManager.testSingleProvider(provider_id, req.user?.id);
            return res.json(result);
        }
        const results = await aiProviderManager.testAllProviders(req.user?.id);
        return res.json({ success: true, providers: results });
    } catch (err) {
        return res.status(500).json({ message: "Gagal melakukan test koneksi AI Provider", detail: err.message });
    }
};

exports.updateAdminAiProvider = async (req, res) => {
    try {
        const { id, model, priority, enabled, http_referer, app_name } = req.body || {};
        if (!id) return res.status(400).json({ message: "ID Provider wajib diisi" });

        const updated = await aiProviderManager.saveProviderSetting({ id, model, priority, enabled, http_referer, app_name });
        return res.json({ message: `Pengaturan ${id} berhasil diperbarui`, data: updated });
    } catch (err) {
        return res.status(500).json({ message: err.message || "Gagal memperbarui pengaturan provider" });
    }
};

exports.saveAdminAiApiKey = async (req, res) => {
    try {
        const { id, api_key, model, priority, enabled, http_referer, referer, app_name } = req.body || {};
        if (!id) return res.status(400).json({ success: false, message: "ID Provider wajib diisi" });

        const updated = await aiProviderManager.saveProviderSetting({
            id,
            api_key,
            model,
            priority,
            enabled,
            http_referer: http_referer || referer,
            app_name
        });
        return res.json({
            success: true,
            message: `Konfigurasi ${id} berhasil disimpan`,
            data: updated,
            masked_key: aiProviderManager.maskKey(updated.api_key)
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message || "Gagal menyimpan konfigurasi AI Provider" });
    }
};

exports.getAdminAiConfig = async (_req, res) => {
    try {
        const providers = await aiProviderManager.loadProviderSettings({ fresh: true });
        const sanitized = providers.map((p) => ({
            id: p.id,
            provider: p.provider,
            api_key: p.api_key,
            masked_key: aiProviderManager.maskKey(p.api_key),
            model: p.model,
            enabled: p.enabled,
            priority: p.priority,
            referer: p.http_referer,
            http_referer: p.http_referer,
            app_name: p.app_name,
            updated_at: p.updated_at
        }));
        return res.json({ success: true, data: sanitized, config: sanitized });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

exports.saveAdminAiConfig = async (req, res) => {
    try {
        const body = req.body || {};
        const configs = Array.isArray(body) ? body : (body.providers || [body]);
        const results = [];

        for (const item of configs) {
            if (item && item.id) {
                const updated = await aiProviderManager.saveProviderSetting({
                    id: item.id,
                    api_key: item.api_key ?? item.apiKey,
                    model: item.model,
                    priority: item.priority,
                    enabled: item.enabled,
                    http_referer: item.http_referer ?? item.referer,
                    app_name: item.app_name ?? item.appName
                });
                results.push(updated);
            }
        }

        return res.json({
            success: true,
            message: "Konfigurasi AI Provider berhasil disimpan",
            data: results
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};
