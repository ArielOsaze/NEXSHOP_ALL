"use strict";

// The RAG rules live in this dependency-free module so that they can be tested
// without a database or an external model.
const STOP_WORDS = new Set(["aku", "saya", "yang", "dan", "atau", "untuk", "di", "ke", "dari", "itu", "ini", "dong", "ya", "yah", "nih", "sih", "tolong", "mau", "ingin", "dengan", "pada", "aja", "saja", "kalo", "kalau", "nya", "apakah", "apa", "bagaimana", "mengapa", "kenapa", "kapan", "siapa", "ada", "punya", "pakai"]);

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
    { canonical: "pembayaran", terms: ["metode pembayaran", "pembayaran", "payment", "qris", "virtual account", "transfer", "bayar"] },

    // Layanan halaman Marketplace. Sebelum ini NexBot gak punya satu pun
    // istilah PPOB di kamusnya, jadi "isi saldo dana" atau "beli token
    // listrik" gak pernah nyantol ke knowledge mana pun.
    { canonical: "e-wallet", terms: ["e wallet", "e-wallet", "ewallet", "dompet digital", "saldo dompet"] },
    { canonical: "dana", terms: ["saldo dana", "isi dana", "topup dana"] },
    { canonical: "ovo", terms: ["saldo ovo", "isi ovo", "topup ovo"] },
    { canonical: "gopay", terms: ["gopay", "go pay", "saldo gopay"] },
    { canonical: "shopeepay", terms: ["shopeepay", "shopee pay", "spay"] },
    { canonical: "linkaja", terms: ["linkaja", "link aja"] },
    { canonical: "pulsa", terms: ["pulsa", "isi pulsa", "beli pulsa"] },
    { canonical: "paket data", terms: ["paket data", "kuota", "voucher kuota", "paket internet"] },
    { canonical: "pln", terms: ["token pln", "token listrik", "listrik pln", "pln"] },
    { canonical: "tagihan", terms: ["tagihan", "pascabayar", "ppob", "pdam", "bpjs", "indihome"] },
    { canonical: "marketplace", terms: ["marketplace", "one stop solution", "layanan digital"] },
    { canonical: "reseller", terms: ["reseller", "harga reseller", "jualan lagi", "jadi agen"] }
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
    { name: "PlayStation Plus", terms: ["playstation plus", "ps plus"] },

    // Entity Marketplace/PPOB. Dipakai ranker buat ngasih kredit ke chunk
    // yang emang ngomongin layanan itu, bukan cuma kebetulan sekata.
    { name: "E-Wallet", terms: ["e wallet", "e-wallet", "ewallet", "dompet digital"] },
    { name: "DANA", terms: ["saldo dana", "isi dana", "topup dana", "dana ewallet"] },
    { name: "OVO", terms: ["ovo"] },
    { name: "GoPay", terms: ["gopay", "go pay"] },
    { name: "ShopeePay", terms: ["shopeepay", "shopee pay"] },
    { name: "LinkAja", terms: ["linkaja", "link aja"] },
    { name: "Pulsa", terms: ["pulsa"] },
    { name: "Paket Data", terms: ["paket data", "kuota", "paket internet"] },
    { name: "Token PLN", terms: ["token pln", "token listrik", "pln"] },
    { name: "Tagihan", terms: ["tagihan", "pascabayar", "ppob", "pdam", "bpjs", "indihome"] },
    { name: "E-Toll", terms: ["e toll", "etoll", "kartu tol"] },
    { name: "Marketplace", terms: ["marketplace"] },
    { name: "Reseller", terms: ["reseller"] }
];

const INTENTS = {
    Trust: ["aman", "terpercaya", "penipu", "scam", "resmi"],
    Legality: ["legal", "legalitas", "oss", "nib", "izin"],
    Escrow: ["escrow", "tahan dana", "rekber"],
    Comparison: ["beda", "bedanya", "perbedaan", "banding", "vs", "versus", "lebih bagus", "pilih mana"],
    Definition: ["apa itu", "apa sih", "artinya", "maksud", "pengertian", "definisi", "jelaskan", "itu apa"],
    Guide: ["cara", "bagaimana", "panduan", "langkah", "tutorial", "aktivasi", "redeem", "gunakan"],
    Purchase: ["beli", "membeli", "pesan", "checkout", "order produk"],
    Pricing: ["harga", "berapa", "biaya", "mahal", "murah"],
    Recommendation: ["rekomendasi", "saran", "cocok", "bagus mana"],
    Payment: ["bayar", "pembayaran", "payment", "qris", "dana", "ovo", "gopay", "transfer", "bank", "va", "ipaymu"],
    Refund: ["refund", "batal", "uang kembali", "garansi", "komplain"],
    Order: ["status pesanan", "status order", "pesanan", "lacak", "tracking", "belum masuk"],
    TechnicalSupport: ["error", "gagal", "tidak bisa", "masalah", "kendala", "login", "otp"],
    Promotion: ["promo", "diskon", "voucher", "kupon", "kode promo"],
    // Intent khusus layanan Marketplace/PPOB, biar pertanyaan "bisa isi
    // saldo DANA gak?" gak keklasifikasi jadi Payment (metode bayar) --
    // dua hal yang beda dan chunk-nya juga beda.
    // Frasa dua kata ("isi saldo", "topup dana") sengaja dipakai karena
    // detectIntent ngasih 3 poin buat frasa multi-kata dan cuma 1 buat kata
    // tunggal. Tanpa ini, "bisa isi saldo DANA gak?" kalah ke intent Payment
    // (yang punya kata tunggal "dana"), lalu NexBot ngejawab pakai chunk
    // metode pembayaran dan nyimpulin NexShop gak jual saldo DANA.
    Marketplace: ["e wallet", "ewallet", "dompet digital", "pulsa", "paket data", "kuota", "token listrik", "token pln", "pln", "tagihan", "pascabayar", "ppob", "pdam", "bpjs", "e toll", "etoll", "marketplace", "isi saldo", "isi ulang", "saldo dana", "saldo ovo", "saldo gopay", "topup dana", "topup ovo", "topup gopay", "isi dana", "isi ovo", "beli pulsa", "isi pulsa"]
};

function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

// Customer Indonesia hampir selalu nempelin klitik ke kata benda:
// "topupnya", "harganya", "caranya", "produknya". Tanpa dipotong, token
// "topupnya" GAK PERNAH match ke knowledge yang nulis "topup" (regex-nya
// pakai word-boundary), jadi pertanyaan sehari-hari kayak "topupnya lama
// gak" nyari ke knowledge yang salah total.
const CLITIC_SUFFIXES = ["nya", "lah", "kah", "pun", "ku", "mu"];

function stripClitic(token) {
    for (const suffix of CLITIC_SUFFIXES) {
        if (token.length > suffix.length + 2 && token.endsWith(suffix)) return token.slice(0, -suffix.length);
    }
    return token;
}

function tokenize(text) {
    const tokens = String(text || "").toLowerCase().split(/\s+/)
        .map((token) => stripClitic(token))
        .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
    return [...new Set(tokens)];
}

// Bahasa Indonesia itu bahasa berimbuhan: customer nulis "beli", knowledge
// nulis "membeli"; customer nulis "aman", knowledge nulis "keamanan". Regex
// word-boundary polos GAK PERNAH nyambungin dua bentuk itu, jadi pertanyaan
// sederhana kayak "kalau saya beli sekarang kapan masuknya" nol match dan
// NexBot langsung jawab "informasi belum tersedia".
//
// Toleransi imbuhan cuma dipakai buat token >= 4 huruf, supaya token pendek
// (mis. "ml", "ff", "va") gak jadi kebanyakan false positive.
const PREFIX_PATTERN = "(?:me|mem|men|meng|meny|di|ter|ber|pe|pem|pen|peng|ke)?";
const SUFFIX_PATTERN = "(?:nya|lah|kah|pun|ku|mu|kan|an|i)?";
const CLITIC_ONLY_PATTERN = "(?:nya|lah|kah|pun|ku|mu)?";

function tokenMatches(token, haystack) {
    const escaped = escapeRegExp(token);
    if (token.length < 4) {
        return new RegExp(`\\b${escaped}${CLITIC_ONLY_PATTERN}\\b`).test(haystack);
    }
    return new RegExp(`\\b${PREFIX_PATTERN}${escaped}${SUFFIX_PATTERN}\\b`).test(haystack);
}

// Semua ejaan/alias yang dikenal buat sebuah entity. Nyocokin entity cuma
// lewat nama kanoniknya bikin artikel "Apa Perbedaan Game Pass Private dan
// Game Pass Sharing?" GAK ke-anggep ngomongin "Xbox Game Pass Private" --
// judulnya kan gak nulis kata "Xbox". Padahal justru itu artikel yang
// paling menjawab pertanyaan "apa bedanya private sama sharing".
function entityTerms(name) {
    const entry = ENTITY_CATALOG.find((candidate) => candidate.name === name);
    const terms = entry ? entry.terms : [];
    return [...new Set([name.toLowerCase(), ...terms.map((term) => term.toLowerCase())])];
}

function entityMentioned(name, haystack) {
    return entityTerms(name).some((term) => new RegExp(`\\b${escapeRegExp(term)}\\b`).test(haystack));
}

// Buat MEMBEDAKAN varian produk (Sharing vs Private), alias satu kata yang
// generik kayak "sharing" atau "private" gak bisa dipercaya: blok keyword
// di knowledge_base sering nyantumin dua-duanya sekaligus, jadi artikel
// Private ikut ke-anggep artikel Sharing. Yang dipakai cuma nama kanonik +
// alias yang terdiri dari beberapa kata ("game pass sharing").
function distinctiveEntityTerms(name) {
    const terms = entityTerms(name).filter((term) => term.includes(" ") || term === name.toLowerCase());
    return terms.length ? terms : [name.toLowerCase()];
}

function entityDistinctlyMentioned(name, haystack) {
    return distinctiveEntityTerms(name).some((term) => new RegExp(`\\b${escapeRegExp(term)}\\b`).test(haystack));
}

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

// Sinyal yang beneran nunjukin sebuah artikel ngomongin KEPERCAYAAN TOKO,
// bukan sekadar kebetulan ngandung kata "aman".
const STORE_TRUST_PATTERN = /nexshop|legalitas|legal|oss|nib|escrow|rekber|terpercaya|penipu|scam|izin usaha|kbli/;

// Artikel yang cakupannya satu produk/game tertentu. Judul kayak "Apakah
// Progress Game Aman pada Game Pass Sharing?" itu PANDUAN PRODUK -- tapi
// sebelumnya keklasifikasi sebagai intent "Trust" cuma gara-gara ada kata
// "aman" di judulnya. Akibatnya, tiap pertanyaan "NexShop aman gak?" dapat
// bonus intent penuh (+35) buat artikel Xbox yang gak nyambung sama sekali,
// dan artikel itu ikut dikirim ke AI sebagai "fakta" soal keamanan toko.
const PRODUCT_SCOPED_PATTERN = /game ?pass|gamepass|xbox|steam|mobile legends|free fire|pubg|valorant|nintendo|playstation|genshin|roblox|forza|magic chess|mlbb/;

function inferKnowledgeIntent(item) {
    const text = `${item.title || ""} ${item.category || ""} ${item.keywords || ""}`.toLowerCase();
    const cat = String(item.category || "").toLowerCase();
    
    // Explicit category safeguard so product/game guides aren't confused as generic Trust/Escrow
    if (cat === "guide" || cat === "product" || cat === "news") {
        if (/cara|panduan|langkah|tutorial|guide/.test(text)) return "Guide";
        if (/aman|sharing|xbox/.test(text)) return "Guide";
        return "GeneralQuestion";
    }

    // Artikel yang scope-nya satu produk gak boleh diklaim sebagai artikel
    // trust/legalitas toko, kecuali dia emang nyebut sinyal toko-nya.
    if (PRODUCT_SCOPED_PATTERN.test(text) && !STORE_TRUST_PATTERN.test(text)) {
        if (/cara|panduan|langkah|tutorial|guide|redeem|aktivasi/.test(text)) return "Guide";
        if (/perbedaan|\bvs\b|versus|comparison/.test(text)) return "Comparison";
        if (/harga|pricing/.test(text)) return "Pricing";
        if (/apa itu|pengertian|definisi|faq/.test(text)) return "Definition";
        return "GeneralQuestion";
    }

    if (/legal|oss|nib/.test(text)) return "Legality";
    if (/escrow|tahan dana/.test(text)) return "Escrow";
    if (/aman|terpercaya|scam|penipu|resmi/.test(text)) return "Trust";
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

// Entity yang PALING SPESIFIK di antara yang terdeteksi. Kalau user nanya
// "Xbox Game Pass Sharing", detektor juga ikut ngasih "Xbox Game Pass" yang
// lebih umum. Tanpa dibedain, SEMUA artikel Game Pass (termasuk yang
// Private) dapat kredit entity penuh dan ikut kekirim ke AI -- itu yang
// bikin NexBot nyampur-nyampur fakta Private ke jawaban soal Sharing.
function specificEntities(entities) {
    return entities.filter(
        (entity) => !entities.some((other) => other !== entity && other.toLowerCase().includes(entity.toLowerCase()))
    );
}

function scoreKnowledge(item, query, intent, entities) {
    const title = String(item.title || "").toLowerCase();
    const keywords = String(item.keywords || "").toLowerCase();
    const content = String(item.content || "").toLowerCase();
    const haystack = `${title} ${keywords} ${content}`;
    const label = `${title} ${keywords}`;
    const tokens = query.tokens;

    const matchedTokens = tokens.filter((token) => tokenMatches(token, haystack)).length;
    const titleTokens = tokens.filter((token) => tokenMatches(token, title)).length;
    const entityMatches = entities.filter((entity) => entityMentioned(entity, haystack)).length;

    // Entity spesifik dihitung cuma dari judul + keyword (bukan isi), supaya
    // artikel yang kebetulan NYINGGUNG produk lain di badan teksnya gak
    // ke-anggep sebagai artikel tentang produk itu.
    const narrow = specificEntities(entities);
    const specificMatches = narrow.filter((entity) => entityDistinctlyMentioned(entity, label)).length;

    const knowledgeIntent = inferKnowledgeIntent(item);
    const semantic = similarity(query.raw, label);

    // Kekerabatan antar-intent. Sebelumnya cuma 4 intent yang punya kerabat,
    // jadi 11 intent sisanya kena penalti mismatch penuh (-25) walau
    // pasangannya jelas nyambung -- pertanyaan ber-intent "Purchase" ketemu
    // artikel ber-intent "Guide" ("Cara Membeli Produk") langsung dibuang,
    // dan NexBot jawab "informasi belum tersedia" buat pertanyaan sepele
    // kayak "kalau saya beli sekarang kapan masuknya ya".
    const related = {
        Trust: ["Trust", "Legality", "Escrow"],
        Legality: ["Trust", "Legality"],
        Escrow: ["Trust", "Escrow", "Payment"],
        Payment: ["Payment", "Escrow", "Purchase"],
        Purchase: ["Purchase", "Guide", "Payment", "Pricing"],
        Guide: ["Guide", "Purchase", "Definition", "TechnicalSupport"],
        Pricing: ["Pricing", "Purchase", "Promotion", "Guide"],
        Promotion: ["Promotion", "Pricing"],
        Definition: ["Definition", "Comparison", "Guide"],
        Comparison: ["Comparison", "Definition"],
        Recommendation: ["Recommendation", "Pricing", "Purchase", "Comparison"],
        Order: ["Order", "TechnicalSupport", "Refund"],
        Refund: ["Refund", "Order", "TechnicalSupport"],
        TechnicalSupport: ["TechnicalSupport", "Guide", "Order"]
    };

    const isStrictIntent = ["Trust", "Legality", "Payment", "Refund", "Escrow"].includes(intent);
    let intentScore = -25;

    if (intent === knowledgeIntent) {
        intentScore = 35;
    } else if (related[intent] && related[intent].includes(knowledgeIntent)) {
        intentScore = 15;
    } else if (intent === "GeneralQuestion" || knowledgeIntent === "GeneralQuestion") {
        intentScore = isStrictIntent ? -15 : 4;
    }

    // Kalau entity-nya cocok kuat (mis. pertanyaan jelas soal "Mobile
    // Legends" dan item ini emang soal Mobile Legends), jangan biarin
    // penalti mismatch-intent (-25) menenggelamkan item yang sebenarnya
    // sangat relevan cuma karena diklasifikasi ke intent yang beda.
    if (intentScore < 0 && entityMatches > 0) {
        intentScore = Math.max(intentScore, -5);
    }

    const score = Math.round(
        intentScore +
        Math.min(32, entityMatches * 18) +
        specificMatches * 12 +
        Math.min(20, titleTokens * 8) +
        Math.min(12, matchedTokens * 3) +
        semantic * 20 +
        Math.min(6, Number(item.priority) || 0)
    );

    // BUKTI — sebuah knowledge cuma boleh jadi kandidat kalau dia beneran
    // nyerempet isi pertanyaannya. Tanpa gerbang ini, bonus intent doang
    // udah cukup buat ngelolosin entri yang nol hubungannya: pertanyaan
    // "topupnya lama gak" sempat ngirim "Hall of Fame", "Latest Gaming
    // News", dan artikel berita MPL ke AI sebagai fakta.
    const hasEvidence = entityMatches > 0 || titleTokens > 0 || matchedTokens >= 2 || semantic >= 0.34;

    return { score, hasEvidence, specificMatches, entityMatches, knowledgeIntent };
}

// Ambang MUTLAK: di bawah ini item dianggap kebetulan doang. Dari data
// nyata knowledge_base NexShop, hit yang beneran relevan skornya 45-115,
// sedangkan noise nyangkut di 38-48 -- makanya ambang mutlak aja gak cukup,
// harus dibarengin ambang RELATIF di bawah.
const MIN_KNOWLEDGE_SCORE = 18;

// Ambang RELATIF terhadap hit terbaik. Ini yang beneran motong ekor noise:
// kalau kandidat teratas skornya 115, item skor 40 jelas bukan jawaban
// pertanyaan yang sama. Sebelumnya seleksi pakai "selisih <= 12 dari top"
// yang justru kebalik -- pas hit teratas lemah (mis. 42), SEMUA noise di
// sekitarnya ikut keangkut.
const RELATIVE_SCORE_RATIO = 0.55;

// Dulu 3 (kekurangan konteks), lalu dinaikin ke 10 (kebanyakan noise: satu
// pertanyaan soal Game Pass Sharing ngirim 10 chunk yang isinya kecampur
// Private, Essentials, dan durasi paket lain -- model kecil jadi nyampur
// fakta). 6 cukup buat nutup topik tanpa nenggelamin jawabannya.
const MAX_SELECTED_KNOWLEDGE = 6;

// Di bawah skor ini, kandidat terbaik pun cuma "nyerempet" — jumlah chunk
// yang dikirim dipangkas biar model gak dikasih tumpukan tebakan.
const LOW_CONFIDENCE_SCORE = 35;

function paragraphs(text) { return String(text || "").split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean); }
function normalizedParagraph(text) { return text.toLowerCase().replace(/[^a-z0-9]/g, ""); }
function deduplicateKnowledge(items) { const seen = new Set(); return items.map((item) => ({ ...item, content: paragraphs(item.content).filter((part) => { const key = normalizedParagraph(part); if (!key || seen.has(key)) return false; seen.add(key); return true; }).join("\n\n") })).filter((item) => item.content); }

function rankKnowledge(items, query, intent, entities) {
    const ranked = (items || [])
        .filter((item) => item && item.status !== "inactive")
        .map((item) => {
            const detail = scoreKnowledge(item, query, intent, entities);
            return { ...item, ...detail };
        })
        // Gerbang bukti dulu, baru ambang skor mutlak.
        .filter((item) => item.hasEvidence && item.score >= MIN_KNOWLEDGE_SCORE)
        .sort((a, b) => b.score - a.score);

    if (!ranked.length) return [];

    // Kalau pertanyaannya nyebut produk spesifik (mis. "Game Pass Sharing"),
    // buang varian lain yang cuma nyangkut lewat nama produk induknya.
    const narrow = specificEntities(entities);
    let pool = ranked;
    if (narrow.length) {
        const onTopic = ranked.filter((item) => item.specificMatches > 0);
        if (onTopic.length) pool = onTopic;
    }

    const floor = Math.max(MIN_KNOWLEDGE_SCORE, pool[0].score * RELATIVE_SCORE_RATIO);

    // Kalau hit terbaiknya sendiri lemah, retrieval-nya lagi nebak. Ngirim 6
    // tebakan sekaligus ke model cuma bikin jawabannya ngambang -- lebih
    // baik kasih 2 kandidat terkuat aja.
    const cap = pool[0].score < LOW_CONFIDENCE_SCORE ? 2 : MAX_SELECTED_KNOWLEDGE;
    const selected = pool.filter((item) => item.score >= floor).slice(0, cap);

    return deduplicateKnowledge(selected);
}

function buildKnowledgeResponse(selected) {
    return selected.map((item) => {
        let content = item.content;
        content = content.replace(/100%\s*(legal|aman)/gi, "$1").replace(/100%\s*legal\s*&\s*aman/gi, "legal dan aman");
        const title = String(item.title || "Untitled"); const type = String(item.category || "General"); 
        return `<<< NEXSHOP KNOWLEDGE >>>\nSOURCE TYPE: ${type}\nTITLE: ${title}\nCONTENT:\n${content}\n<<< END KNOWLEDGE >>>`;
    }).join("\n\n");
}

module.exports = { normalizeQuery, detectIntent, detectEntities, rankKnowledge, buildKnowledgeResponse, deduplicateKnowledge, inferKnowledgeIntent, scoreKnowledge, specificEntities, tokenize, stripClitic, MAX_SELECTED_KNOWLEDGE };
