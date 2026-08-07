"use strict";

const axios = require("axios");

const DEFAULT_MODEL = "gemini-flash-latest";
const FALLBACK_MODELS = [
    "gemini-flash-latest",
    "gemini-1.5-flash-latest",
    "gemini-1.5-pro-latest",
    "gemini-1.5-flash",
    "gemini-1.5-pro"
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
                parts: systemPrompt ? [{ text: `${systemPrompt}\n\nPertanyaan Pengguna: ${prompt}` }] : [{ text: prompt }]
            }
        ];
        const payload = { contents, generationConfig: { temperature: 0.3, maxOutputTokens: 800 } };

        console.log(`\n[AI Request] Provider: Google Gemini | Model: ${modelCandidate}`);

        try {
            const res = await axios.post(
                endpoint,
                payload,
                { timeout: timeoutMs, headers: { "Content-Type": "application/json" } }
            );

            const latencyMs = Date.now() - startTime;
            const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
            const tokenUsage = res.data?.usageMetadata || null;

            if (!text) {
                throw new Error(`Respons Gemini (${modelCandidate}) tidak berisi kandidat teks`);
            }

            console.log(`[AI Response] Provider: Google Gemini | Model: ${modelCandidate} | HTTP Status: ${res.status} | Latency: ${latencyMs}ms`);
            console.log(`[AI Response Received]: "${text.trim().slice(0, 150)}..."`);

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
            const latencyMs = Date.now() - startTime;
            const httpStatus = err.response?.status || 500;
            const errorMessage = err.response?.data?.error?.message || err.message;
            lastError = errorMessage;
            lastHttpStatus = httpStatus;

            console.error(`[AI Error] Provider: Google Gemini | Model: ${modelCandidate} | HTTP Status: ${httpStatus} | Latency: ${latencyMs}ms`);
            console.error(`[AI Error Message]:`, errorMessage);
            console.error(`[AI Error Stack]:`, err.stack || errorMessage);

            const isModelOrQuotaError = httpStatus === 404 || httpStatus === 429 || 
                (httpStatus === 400 && /model|not available|deprecated|not supported|not found|invalid/i.test(errorMessage));

            if (isModelOrQuotaError && modelCandidates.indexOf(modelCandidate) < modelCandidates.length - 1) {
                console.warn(`⚠️ Model Gemini '${modelCandidate}' kendala. Mencoba candidate berikutnya...`);
                continue;
            } else {
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

