const EventEmitter = require('events');
const { createAnomalyDetector } = require('../nexshop-backend/services/anomalyDetectionService');

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function fakeResponse(statusCode) {
    const res = new EventEmitter();
    res.statusCode = statusCode;
    return res;
}

function request(path, method = 'GET') {
    return { path, originalUrl: path, method, ip: '203.0.113.42' };
}

async function finish(detector, req, statusCode) {
    const res = fakeResponse(statusCode);
    detector.observeRequest(req, res);
    res.emit('finish');
    await new Promise((resolve) => setImmediate(resolve));
}

(async () => {
    let now = 1_000_000;
    const alerts = [];
    const detector = createAnomalyDetector({
        now: () => now,
        notifyFn: async (...args) => alerts.push(args),
        cooldownMs: 60_000
    });

    // Five 429 responses from one source are an application-layer abuse signal.
    for (let i = 0; i < 5; i += 1) {
        await finish(detector, request('/api/auth/login', 'POST'), 429);
    }
    assert(alerts.some(([type, message, options]) =>
        type === 'security_anomaly' && /429/.test(message) && options.recipientRole === 'admin'),
        'repeated 429 responses must create an admin-only security alert');

    // A second burst inside cooldown must not send another WhatsApp alert.
    const afterRateLimitAlerts = alerts.length;
    await finish(detector, request('/api/auth/login', 'POST'), 429);
    assert(alerts.length === afterRateLimitAlerts,
        'the same anomaly must respect its cooldown');

    // Eight failed order attempts from the same source indicate bot checkout
    // spam, not a legitimate paid order transition.
    now += 61_000;
    for (let i = 0; i < 8; i += 1) {
        await finish(detector, request('/api/orders', 'POST'), 400);
    }
    assert(alerts.some(([type, message]) =>
        type === 'security_anomaly' && /order|pesanan/i.test(message)),
        'repeated failed order POSTs must create an anomaly alert');

    console.log('PASS sim50: anomaly signals alert admins and obey cooldown');
})().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
