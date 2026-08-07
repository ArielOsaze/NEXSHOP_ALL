"use strict";

const axios = require("axios");

const DEFAULT_MODEL = "meta-llama/llama-3.3-70b-instruct";
const FALLBACK_MODELS = [
    "meta-llama/llama-3.3-70b-instruct",
    "google/gemini-flash-1.5:free",
    "meta-llama/llama-3.2-11b-vision-instruct:free",
    "qwen/qwen-2.5-72b-instruct:free",
    "deepseek/deepseek-r1:free"
];

async function generateContent({ apiKey, preferredModel, prompt, systemPrompt = "", httpReferer, appName, timeoutMs = 12000 }) {
    const startTime = Date.now();
    const modelCandidates = Array.from(new Set([preferredModel || DEFAULT_MODEL, ...FALLBACK_MODELS])).filter(Boolean);

    let lastError = null;
    let lastHttpStatus = 500;

    for (const modelCandidate of modelCandidates) {
        const endpoint = "https://openrouter.ai/api/v1/chat/completions";
        const messages = [];
        if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
        messages.push({ role: "user", content: prompt });

        console.log(`\n[AI Request] Provider: OpenRouter | Model: ${modelCandidate}`);

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
                        "HTTP-Referer": httpReferer || "https://nexshop.id",
                        "X-Title": appName || "NexShop NexBot",
                        "Content-Type": "application/json"
                    }
                }
            );

            const latencyMs = Date.now() - startTime;
            const text = res.data?.choices?.[0]?.message?.content;
            const tokenUsage = res.data?.usage || null;

            if (!text) {
                throw new Error(`Respons OpenRouter (${modelCandidate}) tidak berisi konten`);
            }

            console.log(`[AI Response] Provider: OpenRouter | Model: ${modelCandidate} | HTTP Status: ${res.status} | Latency: ${latencyMs}ms`);
            console.log(`[AI Response Received]: "${text.trim().slice(0, 150)}..."`);

            return {
                provider: "openrouter",
                providerName: "OpenRouter",
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

            console.error(`[AI Error] Provider: OpenRouter | Model: ${modelCandidate} | HTTP Status: ${httpStatus} | Latency: ${latencyMs}ms`);
            console.error(`[AI Error Stack]:`, err.stack || errorMessage);

            const isModelOrQuotaError = httpStatus === 404 || httpStatus === 429 || httpStatus === 402 ||
                (httpStatus === 400 && /model|not available|deprecated|not supported|not found|credit/i.test(errorMessage));

            if (isModelOrQuotaError && modelCandidates.indexOf(modelCandidate) < modelCandidates.length - 1) {
                console.warn(`⚠️ Model OpenRouter '${modelCandidate}' kendala. Mencoba candidate berikutnya...`);
                continue;
            } else {
                return {
                    provider: "openrouter",
                    providerName: "OpenRouter",
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
        provider: "openrouter",
        providerName: "OpenRouter",
        success: false,
        reply: null,
        model: modelCandidates[0],
        latencyMs,
        tokenUsage: null,
        httpStatus: lastHttpStatus,
        error: lastError || "Seluruh model OpenRouter gagal dihubungi"
    };
}

module.exports = {
    providerId: "openrouter",
    providerName: "OpenRouter",
    defaultModel: DEFAULT_MODEL,
    generateContent
};
