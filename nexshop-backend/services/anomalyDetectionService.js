const DEFAULT_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_COOLDOWN_MS = 15 * 60 * 1000;
const MAX_SOURCES = 10_000;
const MAX_REQUESTS_PER_SOURCE = 1_000;

function requestPath(req) {
    return String(req?.path || req?.originalUrl || req?.url || "").split("?")[0] || "/";
}

function isApiRequest(pathname) {
    return pathname === "/api" || pathname.startsWith("/api/");
}

function isOrderAttempt(req, pathname) {
    if (String(req?.method || "").toUpperCase() !== "POST") return false;
    if (/\/notification(?:\/|$)/i.test(pathname)) return false;
    return /^\/api\/(?:orders|topup)(?:\/|$)/i.test(pathname);
}

function createAnomalyDetector(options = {}) {
    const now = typeof options.now === "function" ? options.now : () => Date.now();
    const notifyFn = typeof options.notifyFn === "function" ? options.notifyFn : require("../config/notify").notify;
    const windowMs = Number.isFinite(options.windowMs) ? Math.max(60_000, options.windowMs) : DEFAULT_WINDOW_MS;
    const cooldownMs = Number.isFinite(options.cooldownMs) ? Math.max(0, options.cooldownMs) : DEFAULT_COOLDOWN_MS;
    const sources = new Map();

    function prune(state, timestamp) {
        const cutoff = timestamp - windowMs;
        state.requests = state.requests.filter((item) => item.at >= cutoff);
        state.rateLimited = state.rateLimited.filter((item) => item >= cutoff);
        state.orderAttempts = state.orderAttempts.filter((item) => item.at >= cutoff);
        state.orderFailures = state.orderFailures.filter((item) => item >= cutoff);
    }

    function canAlert(state, signal, timestamp) {
        const lastAlert = state.lastAlerts.get(signal) || 0;
        if (timestamp - lastAlert < cooldownMs) return false;
        state.lastAlerts.set(signal, timestamp);
        return true;
    }

    function sendAlert(state, signal, timestamp, message) {
        if (!canAlert(state, signal, timestamp)) return;
        Promise.resolve(notifyFn("security_anomaly", message, { recipientRole: "admin" }))
            .catch((error) => console.log("Gagal menyimpan alert anomali:", error.message));
    }

    function observeRequest(req, res) {
        if (!res || typeof res.once !== "function") return;
        res.once("finish", () => {
            const pathname = requestPath(req);
            if (!isApiRequest(pathname)) return;

            const timestamp = now();
            const ip = String(req?.ip || req?.socket?.remoteAddress || "unknown").slice(0, 128);
            let state = sources.get(ip);
            if (!state) {
                state = {
                    requests: [],
                    rateLimited: [],
                    orderAttempts: [],
                    orderFailures: [],
                    lastAlerts: new Map()
                };
                sources.set(ip, state);
            }

            state.requests.push({ at: timestamp, pathname });
            if (Number(res.statusCode) === 429) state.rateLimited.push(timestamp);
            if (isOrderAttempt(req, pathname)) {
                state.orderAttempts.push({ at: timestamp, pathname });
                if (Number(res.statusCode) >= 400) state.orderFailures.push(timestamp);
            }
            prune(state, timestamp);
            if (state.requests.length > MAX_REQUESTS_PER_SOURCE) {
                state.requests = state.requests.slice(-MAX_REQUESTS_PER_SOURCE);
            }

            const endpoint = pathname.slice(0, 96);
            if (state.rateLimited.length >= 5) {
                sendAlert(
                    state,
                    "rate_limit_abuse",
                    timestamp,
                    `🚨 Anomali keamanan: ${state.rateLimited.length} respons 429 dari satu sumber dalam ${Math.round(windowMs / 60_000)} menit. IP ${ip}, endpoint ${endpoint}. Kemungkinan bot/brute-force.`
                );
            }

            if (state.orderAttempts.length >= 8 && state.orderFailures.length >= 4) {
                sendAlert(
                    state,
                    "order_spam",
                    timestamp,
                    `🚨 Anomali order: ${state.orderAttempts.length} percobaan POST order/topup, ${state.orderFailures.length} gagal dalam ${Math.round(windowMs / 60_000)} menit. IP ${ip}, endpoint ${endpoint}. Kemungkinan bot spam checkout.`
                );
            }

            if (state.requests.length >= 300) {
                sendAlert(
                    state,
                    "traffic_spike",
                    timestamp,
                    `🚨 Lonjakan traffic API: ${state.requests.length} request dari satu IP dalam ${Math.round(windowMs / 60_000)} menit. IP ${ip}, endpoint terakhir ${endpoint}. Periksa kemungkinan bot atau serangan layer aplikasi.`
                );
            }

            if (sources.size > MAX_SOURCES) {
                const oldestIp = sources.keys().next().value;
                if (oldestIp) sources.delete(oldestIp);
            }
        });
    }

    return { observeRequest };
}

const defaultDetector = createAnomalyDetector();

module.exports = {
    createAnomalyDetector,
    observeRequest: defaultDetector.observeRequest
};
