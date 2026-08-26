const axios = require("axios");
const { validateWaGatewayUrlShape, isStrictLoopbackGatewayHost } = require("./waGatewayUrl");

/**
 * Reconcile the dashboard/database key with the private gateway runtime.
 * The gateway bootstrap endpoint is intentionally restricted to loopback.
 * Never log or return the key itself.
 */
async function syncWaGatewayRuntimeKey({ url, key, axiosClient = axios, timeoutMs = 5000 } = {}) {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey) return { attempted: false, reason: "missing_key" };

    const validation = validateWaGatewayUrlShape(String(url || "").trim());
    if (!validation.ok) throw new Error(`URL Gateway WA ditolak: ${validation.reason}`);

    const parsed = new URL(validation.url);
    if (!isStrictLoopbackGatewayHost(parsed.hostname)) {
        throw new Error("Sinkronisasi runtime gateway hanya boleh ke host loopback.");
    }

    await axiosClient.post(
        `${validation.url}/internal/configure`,
        { apiKey: normalizedKey },
        { timeout: timeoutMs }
    );

    return { attempted: true, url: validation.url };
}

module.exports = { syncWaGatewayRuntimeKey };
