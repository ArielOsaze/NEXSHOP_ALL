"use strict";

// The RAG rules live in this dependency-free module so that they can be tested
// without a database or an external model.
const STOP_WORDS = new Set(["aku", "saya", "yang", "dan", "atau", "untuk", "di", "ke", "dari", "itu", "ini", "dong", "ya", "yah", "nih", "sih", "tolong", "mau", "ingin", "dengan", "pada", "aja", "saja", "kalo", "kalau", "nya"]);

const ALIASES = [
    { canonical: "xbox game pass", terms: ["xbox game pass", "gamepass", "game pass", "gamepas", "gampass", "xgp", "xbox pass"] },
    { canonical: "mobile legends", terms: ["mobile legends", "mobile legend", "mobilelegend", "mlbb", "ml"] },
    { canonical: "free fire", terms: ["free fire", "freefire", "ff"] },
    { canonical: "pubg mobile", terms: ["pubg mobile", "pubgm", "pubg"] },
    { canonical: "valorant", terms: ["valorant points", "valorant point", "valorant", "vp", "val"] },
    { canonical: "steam wallet", terms: ["steam wallet", "voucher steam", "steam code", "steam"] },
    { canonical: "playstation plus", terms: ["playstation plus", "ps plus", "ps+"] },
    { canonical: "nintendo", terms: ["nintendo eshop", "nintendo"] },
    { canonical: "refund", terms: ["pengembalian dana", "uang kembali", "refund"] },
    { canonical: "pembayaran", terms: ["metode pembayaran", "pembayaran", "payment", "qris", "virtual account", "transfer", "bayar"] }
];

const ENTITY_CATALOG = [
    { name: "Xbox Game Pass Sharing", terms: ["game pass sharing", "xbox sharing", "sharing"] },
    { name: "Xbox Game Pass Private", terms: ["game pass private", "xbox private", "private", "personal"] },
    { name: "Xbox Game Pass", terms: ["xbox game pass", "gamepass", "game pass", "gamepas", "gampass", "xgp", "xbox pass"] },
    { name: "Steam Wallet", terms: ["steam wallet", "voucher steam", "steam code", "steam"] },
    { name: "Valorant", terms: ["valorant", "vp"] },
    { name: "Mobile Legends", terms: ["mobile legends", "mobile legend", "mlbb", "ml"] },
    { name: "PUBG Mobile", terms: ["pubg mobile", "pubgm", "pubg"] },
    { name: "Free Fire", terms: ["free fire", "freefire", "ff"] },
    { name: "Nintendo", terms: ["nintendo"] },
    { name: "PlayStation Plus", terms: ["playstation plus", "ps plus"] }
];

const INTENTS = {
    Comparison: ["beda", "bedanya", "perbedaan", "banding", "vs", "versus", "lebih bagus", "pilih mana"],
    Definition: ["apa itu", "apa sih", "artinya", "maksud", "pengertian", "definisi", "jelaskan", "itu apa"],
    Guide: ["cara", "bagaimana", "panduan", "langkah", "tutorial", "aktivasi", "redeem", "gunakan"],
    Purchase: ["beli", "membeli", "pesan", "checkout", "order produk"],
    Pricing: ["harga", "berapa", "biaya", "mahal", "murah"],
    Recommendation: ["rekomendasi", "saran", "cocok", "bagus mana"],
    Payment: ["bayar", "pembayaran", "payment", "qris", "dana", "ovo", "gopay", "transfer", "bank", "va"],
    Refund: ["refund", "batal", "uang kembali", "garansi", "komplain"],
    Order: ["status pesanan", "status order", "pesanan", "lacak", "tracking", "belum masuk"],
    TechnicalSupport: ["error", "gagal", "tidak bisa", "masalah", "kendala", "login", "otp"],
    Promotion: ["promo", "diskon", "voucher", "kupon", "kode promo"]
};

function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function tokenize(text) { return [...new Set(String(text || "").toLowerCase().split(/\s+/).filter((token) => token.length > 1 && !STOP_WORDS.has(token)))]; }

function normalizeQuery(input) {
    let text = String(input || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    text = text.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    // Correct only a small, explicit, domain vocabulary. This avoids silently changing an ID or product name.
    const corrections = [["gampas", "game pass"], ["gamepas", "game pass"], ["gampass", "game pass"], ["gamepass", "game pass"], ["mobel legend", "mobile legends"], ["freefire", "free fire"]];
    for (const [wrong, right] of corrections) text = text.replace(new RegExp(`\\b${escapeRegExp(wrong)}\\b`, "g"), right);
    const canonical = [...new Set(ALIASES.filter((alias) => alias.terms.some((term) => new RegExp(`\\b${escapeRegExp(term)}\\b`).test(text))).map((alias) => alias.canonical))];
    const expandedTerms = new Set([text, ...canonical]);
    for (const alias of ALIASES) if (canonical.includes(alias.canonical)) alias.terms.forEach((term) => expandedTerms.add(term));
    return { raw: text, tokens: tokenize(text), canonical, expandedTerms: [...expandedTerms] };
}

function detectIntent(normalized) {
    const text = typeof normalized === "string" ? normalized : normalized.raw;
    const scores = Object.entries(INTENTS).map(([intent, phrases]) => ({ intent, score: phrases.reduce((score, phrase) => score + (text.includes(phrase) ? (phrase.includes(" ") ? 3 : 1) : 0), 0) })).filter((item) => item.score > 0).sort((a, b) => b.score - a.score);
    return scores[0]?.intent || "GeneralQuestion";
}

function detectEntities(normalized, additionalEntities = []) {
    const text = typeof normalized === "string" ? normalized : normalized.raw;
    return [...ENTITY_CATALOG, ...additionalEntities].filter((entity) => (entity.terms || []).some((term) => new RegExp(`\\b${escapeRegExp(term.toLowerCase())}\\b`).test(text))).map((entity) => entity.name);
}

function trigrams(text) { const value = `  ${String(text || "").toLowerCase()}  `; const result = new Set(); for (let i = 0; i < value.length - 2; i += 1) result.add(value.slice(i, i + 3)); return result; }
function similarity(left, right) { const a = trigrams(left); const b = trigrams(right); if (!a.size || !b.size) return 0; let common = 0; a.forEach((part) => { if (b.has(part)) common += 1; }); return common / (a.size + b.size - common); }

function inferKnowledgeIntent(item) {
    const text = `${item.title || ""} ${item.category || ""} ${item.keywords || ""}`.toLowerCase();
    if (/perbedaan|\bvs\b|versus|comparison/.test(text)) return "Comparison";
    if (/cara|panduan|langkah|tutorial|guide/.test(text)) return "Guide";
    if (/beli|checkout|purchase/.test(text)) return "Purchase";
    if (/harga|pricing/.test(text)) return "Pricing";
    if (/bayar|pembayaran|payment/.test(text)) return "Payment";
    if (/refund|garansi|policy/.test(text)) return "Refund";
    if (/promo|voucher|diskon/.test(text)) return "Promotion";
    if (/status|pesanan|order/.test(text)) return "Order";
    if (/error|kendala|dukungan|support/.test(text)) return "TechnicalSupport";
    if (/rekomendasi/.test(text)) return "Recommendation";
    if (/apa itu|pengertian|faq|definition/.test(text)) return "Definition";
    return "GeneralQuestion";
}

function scoreKnowledge(item, query, intent, entities) {
    const title = String(item.title || "").toLowerCase(); const keywords = String(item.keywords || "").toLowerCase(); const content = String(item.content || "").toLowerCase(); const haystack = `${title} ${keywords} ${content}`;
    const tokens = query.tokens;
    const matchedTokens = tokens.filter((token) => new RegExp(`\\b${escapeRegExp(token)}\\b`).test(haystack)).length;
    const titleTokens = tokens.filter((token) => new RegExp(`\\b${escapeRegExp(token)}\\b`).test(title)).length;
    const entityMatches = entities.filter((entity) => title.includes(entity.toLowerCase()) || keywords.includes(entity.toLowerCase()) || content.includes(entity.toLowerCase())).length;
    const knowledgeIntent = inferKnowledgeIntent(item); const semantic = similarity(query.raw, `${title} ${keywords}`);
    const intentScore = intent === knowledgeIntent ? 30 : (intent === "GeneralQuestion" || knowledgeIntent === "GeneralQuestion" ? 4 : -18);
    return Math.round(intentScore + Math.min(32, entityMatches * 18) + Math.min(20, titleTokens * 8) + Math.min(12, matchedTokens * 3) + semantic * 20 + Math.min(6, Number(item.priority) || 0));
}

function paragraphs(text) { return String(text || "").split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean); }
function normalizedParagraph(text) { return text.toLowerCase().replace(/[^a-z0-9]/g, ""); }
function deduplicateKnowledge(items) { const seen = new Set(); return items.map((item) => ({ ...item, content: paragraphs(item.content).filter((part) => { const key = normalizedParagraph(part); if (!key || seen.has(key)) return false; seen.add(key); return true; }).join("\n\n") })).filter((item) => item.content); }

function rankKnowledge(items, query, intent, entities) {
    const ranked = (items || []).filter((item) => item && item.status !== "inactive").map((item) => ({ ...item, score: scoreKnowledge(item, query, intent, entities) })).filter((item) => item.score > 8).sort((a, b) => b.score - a.score);
    if (!ranked.length) return [];
    const selected = [ranked[0]];
    for (const item of ranked.slice(1)) {
        if (selected.length >= 3) break;
        const sameEntity = entities.some((entity) => `${item.title} ${item.keywords}`.toLowerCase().includes(entity.toLowerCase()));
        const comparison = intent === "Comparison" && item.score >= ranked[0].score - 18;
        if (sameEntity || comparison) selected.push(item);
    }
    return deduplicateKnowledge(selected);
}

function buildKnowledgeResponse(items) { return items.map((item) => { const title = String(item.title || "").replace(/^(faq|panduan produk|panduan topup)\s*:\s*/i, "").trim(); return title ? `${title}\n\n${item.content}` : item.content; }).join("\n\n"); }

module.exports = { normalizeQuery, detectIntent, detectEntities, rankKnowledge, buildKnowledgeResponse, deduplicateKnowledge, inferKnowledgeIntent };
