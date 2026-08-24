"use strict";

const axios = require("axios");

// ===========================================================
// KENAPA DAFTAR MODELNYA DIAMBIL RUNTIME, BUKAN DI-HARDCODE
//
// Groq rutin men-decommission model lama. Daftar statis yang dulu ada di
// sini (llama-3.3-70b-versatile, llama-3.1-8b-instant, mixtral-8x7b-32768,
// gemma2-9b-it) SEMUANYA sudah dihapus dari katalog Groq -- jadi tiap
// permintaan NexBot nyoba 4 model, gagal 4-4nya (404/400), lalu jatuh ke
// kalimat "Maaf, informasi belum tersedia". Dari sisi user, NexBot
// kelihatan gak bisa jawab APA PUN, padahal retrieval-nya benar.
//
// Sekarang kandidat model ditanya langsung ke /v1/models punya Groq dan
// di-cache 30 menit, jadi daftarnya ikut kalau Groq ganti katalog lagi.
// Daftar statis di bawah cuma jaring pengaman kalau endpoint itu gak bisa
// dihubungi.
// ===========================================================
const DEFAULT_MODEL = "openai/gpt-oss-20b";
const FALLBACK_MODELS = [
    "openai/gpt-oss-20b",
    "openai/gpt-oss-120b",
    "groq/compound-mini",
    "qwen/qwen3.6-27b"
];

// Model non-chat yang gak boleh dipakai buat NexBot (speech-to-text,
// klasifikasi prompt, TTS).
const NON_CHAT_MODEL_PATTERN = /whisper|prompt-guard|tts|orpheus|safeguard/i;

const MODEL_CACHE_TTL_MS = 30 * 60 * 1000;
let modelCache = { models: [], ts: 0 };

async function listAvailableModels(apiKey) {
    const now = Date.now();
    if (modelCache.models.length && now - modelCache.ts < MODEL_CACHE_TTL_MS) {
        return modelCache.models;
    }

    try {
        const res = await axios.get("https://api.groq.com/openai/v1/models", {
            headers: { Authorization: `Bearer ${apiKey}` },
            timeout: 2500
        });

        const models = (res.data?.data || [])
            .map((m) => m.id)
            .filter((id) => id && !NON_CHAT_MODEL_PATTERN.test(id));

        if (models.length) {
            modelCache = { models, ts: now };
            console.log(`[Groq] ${models.length} model chat tersedia: ${models.join(", ")}`);
        }
        return models;
    } catch (err) {
        console.warn(`[Groq] Gagal ambil daftar model (${err.response?.status || err.message}), pakai daftar statis.`);
        return [];
    }
}

async function generateContent({ apiKey, preferredModel, prompt, systemPrompt = "", timeoutMs = 10000 }) {
    const startTime = Date.now();

    const available = await listAvailableModels(apiKey);
    const isUsable = (model) => !available.length || available.includes(model);

    // Model pilihan admin tetap didahulukan, TAPI cuma kalau Groq emang
    // masih punya model itu -- kalau enggak, langsung lompat ke model yang
    // beneran ada daripada buang satu request buat dapat 404.
    const candidates = [
        preferredModel,
        ...FALLBACK_MODELS,
        ...available
    ].filter((model) => Boolean(model) && isUsable(model));

    const modelCandidates = Array.from(new Set(candidates.length ? candidates : [DEFAULT_MODEL]));

    let lastError = null;
    let lastHttpStatus = 500;

    for (const modelCandidate of modelCandidates) {
        const endpoint = "https://api.groq.com/openai/v1/chat/completions";
        const messages = [];
        if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
        messages.push({ role: "user", content: prompt });

        console.log(`\n[AI Request] Provider: Groq AI | Model: ${modelCandidate}`);

        try {
            const res = await axios.post(
                endpoint,
                {
                    model: modelCandidate,
                    messages,
                    temperature: 0.3,
                    max_tokens: 800
                },
                {
                    timeout: timeoutMs,
                    headers: {
                        "Authorization": `Bearer ${apiKey}`,
                        "Content-Type": "application/json"
                    }
                }
            );

            const latencyMs = Date.now() - startTime;
            const text = res.data?.choices?.[0]?.message?.content;
            const tokenUsage = res.data?.usage || null;

            if (!text) {
                throw new Error(`Respons Groq (${modelCandidate}) tidak berisi konten`);
            }

            console.log(`[AI Response] Provider: Groq AI | Model: ${modelCandidate} | HTTP Status: ${res.status} | Latency: ${latencyMs}ms`);
            console.log(`[AI Response Received]: "${text.trim().slice(0, 150)}..."`);

            return {
                provider: "groq",
                providerName: "Groq AI",
                success: true,
                reply: text.trim(),
                model: modelCandidate,
                latencyMs,
                tokenUsage,
                httpStatus: res.status,
                error: null
            };
        } catch (err) {
            const latencyMs = Date.now() - startTime;
            const httpStatus = err.response?.status || 500;
            const errorMessage = err.response?.data?.error?.message || err.message;
            lastError = errorMessage;
            lastHttpStatus = httpStatus;

            console.error(`[AI Error] Provider: Groq AI | Model: ${modelCandidate} | HTTP Status: ${httpStatus} | Latency: ${latencyMs}ms`);
            console.error(`[AI Error Stack]:`, err.stack || errorMessage);

            const isModelOrQuotaError = httpStatus === 404 || httpStatus === 429 ||
                (httpStatus === 400 && /model|not available|deprecated|not supported|not found|decommissioned/i.test(errorMessage));

            if (isModelOrQuotaError && modelCandidates.indexOf(modelCandidate) < modelCandidates.length - 1) {
                console.warn(`⚠️ Model Groq '${modelCandidate}' kendala. Mencoba candidate berikutnya...`);
                continue;
            } else {
                return {
                    provider: "groq",
                    providerName: "Groq AI",
                    success: false,
                    reply: null,
                    model: modelCandidate,
                    latencyMs,
                    tokenUsage: null,
                    httpStatus,
                    error: errorMessage
                };
            }
        }
    }

    const latencyMs = Date.now() - startTime;
    return {
        provider: "groq",
        providerName: "Groq AI",
        success: false,
        reply: null,
        model: modelCandidates[0],
        latencyMs,
        tokenUsage: null,
        httpStatus: lastHttpStatus,
        error: lastError || "Seluruh model Groq gagal dihubungi"
    };
}

module.exports = {
    providerId: "groq",
    providerName: "Groq AI",
    defaultModel: DEFAULT_MODEL,
    generateContent
};
