const axios = require("axios");
const { getRuntimeConfig } = require("./runtimeConfigService");

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE_TIMEOUT_MS = 7000;

async function getTurnstileConfig() {
    const config = await getRuntimeConfig();
    return {
        siteKey: String(config.TURNSTILE_SITE_KEY || "").trim(),
        secretKey: String(config.TURNSTILE_SECRET_KEY || "").trim(),
        allowedHostnames: String(config.TURNSTILE_ALLOWED_HOSTNAMES || "")
            .split(",")
            .map((hostname) => hostname.trim().toLowerCase())
            .filter(Boolean)
    };
}

async function isTurnstileRequired() {
    // Production must fail closed. Local development stays usable without
    // provisioning a public Turnstile site, unless explicitly enabled.
    const config = await getRuntimeConfig();
    return process.env.NODE_ENV === "production" || config.TURNSTILE_REQUIRED === true;
}

async function verifyTurnstile(token, remoteIp) {
    const { secretKey, allowedHostnames } = await getTurnstileConfig();
    if (!secretKey) {
        return { ok: false, reason: "not_configured" };
    }
    if (!token || typeof token !== "string" || token.length > 4096) {
        return { ok: false, reason: "missing_token" };
    }

    try {
        const body = new URLSearchParams({ secret: secretKey, response: token });
        if (remoteIp) body.set("remoteip", remoteIp);

        const response = await axios.post(TURNSTILE_VERIFY_URL, body.toString(), {
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            timeout: TURNSTILE_TIMEOUT_MS,
            validateStatus: (status) => status >= 200 && status < 500
        });
        const result = response.data || {};
        if (!result.success) return { ok: false, reason: "challenge_failed" };

        const hostname = String(result.hostname || "").toLowerCase();
        if (allowedHostnames.length && (!hostname || !allowedHostnames.includes(hostname))) {
            return { ok: false, reason: "hostname_mismatch" };
        }
        return { ok: true };
    } catch (error) {
        console.error("Turnstile verification failed:", error.message);
        return { ok: false, reason: "verification_unavailable" };
    }
}

module.exports = { getTurnstileConfig, isTurnstileRequired, verifyTurnstile };
