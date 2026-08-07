"use strict";

const axios = require("axios");

const DEFAULT_MODEL = "llama-3.3-70b-versatile";
const FALLBACK_MODELS = [
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
    "llama3-70b-8192",
    "mixtral-8x7b-32768"
];

async function generateContent({ apiKey, preferredModel, prompt, systemPrompt = "", timeoutMs = 10000 }) {
    const startTime = Date.now();
    const modelCandidates = Array.from(new Set([preferredModel || DEFAULT_MODEL, ...FALLBACK_MODELS])).filter(Boolean);

    let lastError = null;
    let lastHttpStatus = 500;

    for (const modelCandidate of modelCandidates) {
        const endpoint = "https://api.groq.com/openai/v1/chat/completions";
        const messages = [];
        if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
        messages.push({ role: "user", content: prompt });

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
            const httpStatus = err.response?.status || 500;
            const errorMessage = err.response?.data?.error?.message || err.message;
            lastError = errorMessage;
            lastHttpStatus = httpStatus;

            const isModelOrQuotaError = httpStatus === 404 || httpStatus === 429 ||
                (httpStatus === 400 && /model|not available|deprecated|not supported|not found/i.test(errorMessage));

            if (isModelOrQuotaError) {
                continue;
            } else {
                const latencyMs = Date.now() - startTime;
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
