"use strict";

const supabase = require("../config/db");
const { getStoreSettings } = require("../config/settings");
const { normalizeQuery, detectIntent, detectEntities, rankKnowledge, buildKnowledgeResponse } = require("../utils/nexbotEngine");

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

async function answer(message, sessionId, user) {
    const result = await retrieveKnowledge(message, sessionId, user);
    const reply = result.selected.length ? buildKnowledgeResponse(result.selected) : unavailableReply();
    const source = result.selected.length ? "knowledge" : "handoff";
    const knowledgeIds = result.selected.map((item) => String(item.id));
    await Promise.allSettled([
        saveConversation({ userId: user?.id, sessionId, role: "user", message, intent: result.intent, knowledgeIds }),
        saveConversation({ userId: user?.id, sessionId, role: "assistant", message: reply, intent: result.intent, knowledgeIds }),
        updateUserMemory(user, result.query, result.intent, result.entities),
        saveAnalytics({ ...result, source, failed: !result.selected.length, user, sessionId })
    ]);
    return { reply, source, handoff: !result.selected.length, intent: result.intent, entities: result.entities, knowledgeIds };
}

exports.chat = async (req, res) => {
    const message = safeMessage(req.body.message);
    if (!message) return res.status(400).json({ message: "Pesan tidak boleh kosong" });
    const sessionId = safeSessionId(req.body.session_id || req.headers["x-session-id"]);
    try {
        const result = await answer(message, sessionId, req.user || null);
        return res.json({ reply: result.reply, session_id: sessionId, handoff: result.handoff, source: result.source, intent: result.intent, knowledge_ids: result.knowledgeIds });
    } catch (error) {
        console.error("NexBot chat error:", error.message);
        return res.status(500).json({ message: "NexBot sedang mengalami kendala. Silakan coba lagi." });
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

exports.updateKnowledgeBase = async (req, res) => {
    const payload = knowledgePayload(req.body, true);
    if (!Object.keys(payload).length) return res.status(400).json({ message: "Tidak ada perubahan valid" });
    const { data, error } = await supabase.from("knowledge_base").update(payload).eq("id", req.params.id).select().maybeSingle();
    if (error) return res.status(503).json({ message: "Gagal memperbarui knowledge", detail: error.message });
    if (!data) return res.status(404).json({ message: "Knowledge tidak ditemukan" });
    return res.json({ message: "Knowledge berhasil diperbarui", data });
};

exports.deleteKnowledgeBase = async (req, res) => {
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
