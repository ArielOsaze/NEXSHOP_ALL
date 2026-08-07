"use strict";

require("dotenv").config();
const aiProviderManager = require("../services/aiProviderManager");

async function runDiagnostics() {
    console.log("=================================================");
    console.log("   NEXSHOP MULTI-AI PROVIDER DIAGNOSTIC TEST    ");
    console.log("=================================================\n");

    console.log("1. Checking Loaded AI Settings...");
    const settings = await aiProviderManager.loadProviderSettings({ fresh: true });
    console.table(settings.map(s => ({
        ID: s.id,
        Provider: s.provider,
        Enabled: s.enabled,
        Priority: s.priority,
        Model: s.model,
        "Has API Key": !!s.api_key
    })));

    console.log("\n2. Testing Single Provider Ping Tests...");
    for (const p of settings) {
        console.log(`\n--- Testing ${p.provider} (${p.id}) ---`);
        const result = await aiProviderManager.testSingleProvider(p.id);
        console.log("Ping Result:", {
            success: result.success,
            model: result.model,
            latency_ms: result.latency_ms,
            http_status: result.http_status,
            reply: result.reply ? result.reply.slice(0, 60) + "..." : null,
            error: result.error
        });
    }

    console.log("\n3. Testing Chatbot Response Flow via AIProviderManager...");
    const chatPrompt = "Halo NexBot! Apa saja metode pembayaran yang tersedia di NexShop?";
    const systemPrompt = "Kamu adalah NexBot. Jawab singkat dan ramah.";

    console.log(`Sending Prompt: "${chatPrompt}"`);
    const aiRes = await aiProviderManager.generateResponse({
        prompt: chatPrompt,
        systemPrompt,
        userId: "test-user-123",
        sessionId: "test-session-diag"
    });

    console.log("\nFinal Chat Response Summary:");
    console.log({
        success: aiRes.success,
        provider: aiRes.provider,
        providerName: aiRes.providerName,
        model: aiRes.model,
        latencyMs: aiRes.latencyMs,
        reply: aiRes.reply ? aiRes.reply.slice(0, 150) + "..." : null,
        error: aiRes.error
    });

    console.log("\n=================================================");
    console.log("               DIAGNOSTIC COMPLETE               ");
    console.log("=================================================");
    process.exit(0);
}

runDiagnostics().catch((err) => {
    console.error("Diagnostic execution error:", err);
    process.exit(1);
});
