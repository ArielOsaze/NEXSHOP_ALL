"use strict";

const axios = require("axios");

const DEFAULT_MODEL = "gemini-flash-latest";
const FALLBACK_MODELS = [
    "gemini-flash-latest",
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-pro-latest",
    "gemini-3.5-flash",
    "gemini-2.0-flash-lite"
];

async function generateContent({ apiKey, preferredModel, prompt, systemPrompt = "", timeoutMs = 10000 }) {
    const startTime = Date.now();
    const modelCandidates = Array.from(new Set([preferredModel || DEFAULT_MODEL, ...FALLBACK_MODELS])).filter(Boolean);

    let lastError = null;
    let lastHttpStatus = 500;

    for (const modelCandidate of modelCandidates) {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelCandidate)}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const contents = [
            {
                role: "user",
                parts: systemPrompt ? [{ text: systemPrompt }, { text: prompt }] : [{ text: prompt }]
            }
        ];

        try {
            const res = await axios.post(
                endpoint,
                { contents, generationConfig: { temperature: 0.3, maxOutputTokens: 800 } },
                { timeout: timeoutMs, headers: { "Content-Type": "application/json" } }
            );

            const latencyMs = Date.now() - startTime;
            const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
            const tokenUsage = res.data?.usageMetadata || null;

            if (!text) {
                throw new Error(`Respons Gemini (${modelCandidate}) tidak berisi kandidat teks`);
            }

            return {
                provider: "gemini",
                providerName: "Google Gemini",
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
                    provider: "gemini",
                    providerName: "Google Gemini",
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
        provider: "gemini",
        providerName: "Google Gemini",
        success: false,
        reply: null,
        model: modelCandidates[0],
        latencyMs,
        tokenUsage: null,
        httpStatus: lastHttpStatus,
        error: lastError || "Seluruh model Gemini gagal dihubungi"
    };
}

module.exports = {
    providerId: "gemini",
    providerName: "Google Gemini",
    defaultModel: DEFAULT_MODEL,
    generateContent
};
