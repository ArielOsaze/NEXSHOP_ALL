"use strict";

const supabase = require("../config/db");
const geminiProvider = require("./geminiProvider");
const groqProvider = require("./groqProvider");
const openrouterProvider = require("./openrouterProvider");

const PROVIDERS = {
    gemini: geminiProvider,
    groq: groqProvider,
    openrouter: openrouterProvider
};

const DEFAULT_SETTINGS = [
    { id: "gemini", provider: "Google Gemini", model: "gemini-flash-latest", enabled: true, priority: 1 },
    { id: "groq", provider: "Groq AI", model: "llama-3.3-70b-versatile", enabled: true, priority: 2 },
    { id: "openrouter", provider: "OpenRouter", model: "meta-llama/llama-3.3-70b-instruct", enabled: true, priority: 3 }
];

let settingsCache = { data: null, ts: 0 };
const CACHE_TTL_MS = 15 * 1000;

function maskKey(value) {
    if (!value) return "Belum diisi";
    if (value.length <= 8) return "••••••••";
    return value.slice(0, 4) + "••••••••" + value.slice(-4);
}

const { getApiKeys } = require("../config/settings");

async function loadProviderSettings({ fresh = false } = {}) {
    const now = Date.now();
    if (!fresh && settingsCache.data && now - settingsCache.ts < CACHE_TTL_MS) {
        return settingsCache.data;
    }

    const [dbRes, appApiKeys] = await Promise.all([
        supabase.from("ai_provider_settings").select("*").order("priority", { ascending: true }),
        getApiKeys({ fresh }).catch(() => ({}))
    ]);

    const data = dbRes.data;
    let rows = (data && data.length) ? data : DEFAULT_SETTINGS;

    // Merge fallback API keys from getApiKeys() / process.env if DB api_key is empty
    const envKeys = {
        gemini: appApiKeys.gemini_api_key || process.env.GEMINI_API_KEY || "",
        groq: process.env.GROQ_API_KEY || "",
        openrouter: process.env.OPENROUTER_API_KEY || ""
    };

    const merged = DEFAULT_SETTINGS.map((def) => {
        const found = rows.find((r) => r.id === def.id) || {};
        const key = (found.api_key && found.api_key.trim()) ? found.api_key.trim() : (envKeys[def.id] || "");
        return {
            id: def.id,
            provider: found.provider || def.provider,
            api_key: key,
            model: found.model || def.model,
            enabled: found.enabled !== undefined ? found.enabled : def.enabled,
            priority: Number(found.priority || def.priority),
            created_at: found.created_at || new Date().toISOString(),
            updated_at: found.updated_at || new Date().toISOString()
        };
    }).sort((a, b) => a.priority - b.priority);

    settingsCache = { data: merged, ts: now };
    return merged;
}

async function saveProviderSetting({ id, api_key, model, enabled, priority }) {
    if (!PROVIDERS[id]) {
        throw new Error(`Provider ID '${id}' tidak valid`);
    }

    const payload = {
        id,
        provider: PROVIDERS[id].providerName,
        updated_at: new Date().toISOString()
    };

    if (api_key !== undefined) payload.api_key = String(api_key).trim();
    if (model !== undefined) payload.model = String(model).trim();
    if (enabled !== undefined) payload.enabled = Boolean(enabled);
    if (priority !== undefined) payload.priority = Number(priority) || 1;

    const { data, error } = await supabase
        .from("ai_provider_settings")
        .upsert(payload, { onConflict: "id" })
        .select()
        .single();

    if (error) {
        if (error.code === "PGRST204" || /schema cache|relation.*does not exist/i.test(error.message)) {
            throw new Error("Tabel 'ai_provider_settings' belum tersedia di Supabase. Silakan jalankan file migrations-23-multi-ai-provider.sql di Supabase SQL Editor.");
        }
        throw new Error(`Gagal menyimpan provider setting ${id}: ${error.message}`);
    }

    settingsCache = { data: null, ts: 0 };
    return data;
}

async function logProviderRequest({ provider, model, userPrompt, responseText, latencyMs, httpStatus, tokenUsage, isSuccess, errorMessage, userId, sessionId }) {
    const payload = {
        provider,
        model: model || "unknown",
        user_prompt: userPrompt ? String(userPrompt).slice(0, 1000) : null,
        response_text: responseText ? String(responseText).slice(0, 1000) : null,
        latency_ms: Math.round(latencyMs || 0),
        http_status: Number(httpStatus || 200),
        token_usage: tokenUsage || null,
        is_success: Boolean(isSuccess),
        error_message: errorMessage ? String(errorMessage).slice(0, 1000) : null,
        user_id: userId ? String(userId) : null,
        session_id: sessionId || null
    };

    try {
        await supabase.from("ai_provider_logs").insert(payload);
    } catch (err) {
        console.warn("⚠️ Error saving ai_provider_log:", err.message);
    }
}

async function generateResponse({ prompt, systemPrompt = "", userId = null, sessionId = null }) {
    const providersList = await loadProviderSettings();
    const enabledProviders = providersList.filter((p) => p.enabled && p.api_key);

    if (!enabledProviders.length) {
        return {
            success: false,
            reply: null,
            provider: null,
            error: "Tidak ada AI Provider yang aktif atau memiliki API Key terpasang."
        };
    }

    let lastError = null;

    for (const pConfig of enabledProviders) {
        const driver = PROVIDERS[pConfig.id];
        if (!driver) continue;

        const res = await driver.generateContent({
            apiKey: pConfig.api_key,
            preferredModel: pConfig.model,
            prompt,
            systemPrompt,
            timeoutMs: 10000
        });

        await logProviderRequest({
            provider: res.provider,
            model: res.model,
            userPrompt: prompt,
            responseText: res.reply,
            latencyMs: res.latencyMs,
            httpStatus: res.httpStatus,
            tokenUsage: res.tokenUsage,
            isSuccess: res.success,
            errorMessage: res.error,
            userId,
            sessionId
        });

        if (res.success && res.reply) {
            return {
                success: true,
                reply: res.reply,
                provider: res.provider,
                providerName: res.providerName,
                model: res.model,
                latencyMs: res.latencyMs
            };
        }

        lastError = res.error || `Provider ${res.providerName} gagal merespons`;
        console.warn(`🔄 Failover Triggered: ${pConfig.provider} gagal (${res.httpStatus}: ${res.error}). Mencoba provider berikutnya...`);
    }

    return {
        success: false,
        reply: null,
        provider: null,
        error: lastError || "Seluruh AI Provider gagal memberikan balasan."
    };
}

async function testSingleProvider(providerId, userId = null) {
    const providersList = await loadProviderSettings({ fresh: true });
    const pConfig = providersList.find((p) => p.id === providerId);

    if (!pConfig) {
        return {
            success: false,
            connected: false,
            provider: providerId,
            message: `Provider '${providerId}' tidak ditemukan`
        };
    }

    if (!pConfig.api_key) {
        return {
            success: false,
            connected: false,
            provider: providerId,
            providerName: pConfig.provider,
            message: `API Key untuk ${pConfig.provider} belum diisi.`,
            masked_key: maskKey(pConfig.api_key),
            model: pConfig.model
        };
    }

    const driver = PROVIDERS[providerId];
    const pingPrompt = "Ping test koneksi AI NexShop. Jawab singkat 'OK'.";
    const res = await driver.generateContent({
        apiKey: pConfig.api_key,
        preferredModel: pConfig.model,
        prompt: pingPrompt,
        systemPrompt: "Jawab tes ping.",
        timeoutMs: 8000
    });

    await logProviderRequest({
        provider: res.provider,
        model: res.model,
        userPrompt: "[PING_TEST] " + pingPrompt,
        responseText: res.reply,
        latencyMs: res.latencyMs,
        httpStatus: res.httpStatus,
        tokenUsage: res.tokenUsage,
        isSuccess: res.success,
        errorMessage: res.error,
        userId,
        sessionId: "ping-test"
    });

    return {
        success: res.success,
        connected: res.success,
        provider: res.provider,
        providerName: res.providerName,
        model: res.model,
        latency_ms: res.latencyMs,
        http_status: res.httpStatus,
        reply: res.reply,
        error: res.error,
        masked_key: maskKey(pConfig.api_key)
    };
}

async function testAllProviders(userId = null) {
    const ids = Object.keys(PROVIDERS);
    const results = await Promise.all(ids.map((id) => testSingleProvider(id, userId)));
    return results;
}

async function getOverallStatus() {
    const [settingsList, logsRes] = await Promise.all([
        loadProviderSettings(),
        supabase.from("ai_provider_logs").select("*").order("created_at", { ascending: false }).limit(500)
    ]);

    const logs = logsRes.data || [];
    
    // Group logs by provider
    const providerStats = {};
    for (const pConfig of settingsList) {
        const pLogs = logs.filter((l) => l.provider === pConfig.id);
        const totalReq = pLogs.length;
        const successReq = pLogs.filter((l) => l.is_success).length;
        const failedReq = totalReq - successReq;
        const successRate = totalReq > 0 ? Number(((successReq / totalReq) * 100).toFixed(1)) : 100.0;
        const lastSuccess = pLogs.find((l) => l.is_success)?.created_at || null;
        const lastFailed = pLogs.find((l) => !l.is_success);
        const lastFailedAt = lastFailed?.created_at || null;
        const lastError = lastFailed?.error_message || null;
        const validLat = pLogs.map((l) => l.latency_ms).filter((t) => Number.isInteger(t) && t > 0);
        const avgLat = validLat.length ? Math.round(validLat.reduce((a, b) => a + b, 0) / validLat.length) : 0;
        const isConnected = !!pConfig.api_key && (totalReq === 0 || (pLogs[0] && pLogs[0].is_success));

        providerStats[pConfig.id] = {
            id: pConfig.id,
            provider: pConfig.provider,
            enabled: pConfig.enabled,
            priority: pConfig.priority,
            has_api_key: !!pConfig.api_key,
            masked_key: maskKey(pConfig.api_key),
            model: pLogs[0]?.model || pConfig.model,
            connected: isConnected,
            total_requests: totalReq,
            successful_requests: successReq,
            failed_requests: failedReq,
            success_rate: successRate,
            avg_latency_ms: avgLat,
            last_request: pLogs[0]?.created_at || null,
            last_success: lastSuccess,
            last_failed: lastFailedAt,
            last_error: lastError
        };
    }

    const enabledList = settingsList.filter((p) => p.enabled && p.api_key).sort((a, b) => a.priority - b.priority);
    const activeProvider = enabledList[0] ? enabledList[0].provider : "None";

    return {
        providers: providerStats,
        priority_order: settingsList.map((p) => ({ id: p.id, name: p.provider, priority: p.priority, enabled: p.enabled })),
        active_provider: activeProvider,
        active_provider_id: enabledList[0]?.id || null
    };
}

async function getFilteredLogs({ provider, status, date, limit = 100 }) {
    let query = supabase.from("ai_provider_logs").select("*").order("created_at", { ascending: false }).limit(limit);

    if (provider && provider !== "all") {
        query = query.eq("provider", provider);
    }
    if (status === "success") {
        query = query.eq("is_success", true);
    } else if (status === "failed") {
        query = query.eq("is_success", false);
    }
    if (date) {
        query = query.gte("created_at", `${date}T00:00:00.000Z`).lte("created_at", `${date}T23:59:59.999Z`);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data || [];
}

module.exports = {
    loadProviderSettings,
    saveProviderSetting,
    generateResponse,
    testSingleProvider,
    testAllProviders,
    getOverallStatus,
    getFilteredLogs,
    maskKey
};
