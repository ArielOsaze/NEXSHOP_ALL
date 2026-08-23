const jwt = require("jsonwebtoken");
const supabase = require("../config/db");
const { isMissingTableError } = require("../services/resellerService");

function cleanIp(rawIp) {
    if (!rawIp) return "";
    let ip = String(rawIp).trim();
    if (ip.startsWith("::ffff:")) ip = ip.slice(7);
    if (ip === "::1") ip = "127.0.0.1";
    return ip;
}

function getClientIp(req) {
    const forwarded = req.headers["x-forwarded-for"];
    if (forwarded) {
        const first = forwarded.split(",")[0].trim();
        if (first) return cleanIp(first);
    }
    const cfIp = req.headers["cf-connecting-ip"];
    if (cfIp) return cleanIp(cfIp);
    const realIp = req.headers["x-real-ip"];
    if (realIp) return cleanIp(realIp);
    return cleanIp(req.ip || req.connection?.remoteAddress || "");
}

module.exports = async (req, res, next) => {
    const headerApiKey = req.headers["x-nexshop-api-key"] || req.headers["x-api-key"];
    const headerSecret = req.headers["x-nexshop-secret"] || req.headers["x-api-secret"];
    const authHeader = req.headers.authorization || "";

    let token = "";
    if (authHeader) {
        const match = authHeader.match(/^Bearer\s+(.+)$/i);
        if (match) token = match[1].trim();
    }

    // 1. Dukungan API Key Reseller
    const targetApiKey = (headerApiKey ? String(headerApiKey).trim() : "") || (token.startsWith("nx_live_") ? token : "");
    if (targetApiKey) {
        try {
            const { data: keyRecord, error } = await supabase
                .from("reseller_api_keys")
                .select("id, user_id, api_key, secret_key, ip_whitelist, is_active, total_requests")
                .eq("api_key", targetApiKey)
                .maybeSingle();

            if (!error && keyRecord && keyRecord.is_active) {
                let ipAllowed = true;
                if (keyRecord.ip_whitelist && keyRecord.ip_whitelist.trim()) {
                    const clientIp = getClientIp(req);
                    const allowedIps = keyRecord.ip_whitelist
                        .split(",")
                        .map((item) => cleanIp(item))
                        .filter(Boolean);
                    ipAllowed = allowedIps.some((allowed) => allowed === clientIp || allowed === "*" || clientIp === "127.0.0.1");
                }

                if (ipAllowed) {
                    const { data: user } = await supabase
                        .from("users")
                        .select("id, email, fullname, role, reseller_status, reseller_tier")
                        .eq("id", keyRecord.user_id)
                        .maybeSingle();

                    if (user && user.reseller_status === "approved") {
                        req.user = {
                            id: user.id,
                            email: user.email,
                            fullname: user.fullname,
                            role: user.role,
                            reseller_status: user.reseller_status,
                            reseller_tier: user.reseller_tier,
                            is_api_key: true,
                            api_key_id: keyRecord.id
                        };
                        return next();
                    }
                }
            }
        } catch {
            /* lanjut ke JWT atau guest */
        }
    }

    // 2. JWT Bearer Token standar
    if (token && !token.startsWith("nx_live_")) {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || "nexshop-secret-jwt-key-2026");
            req.user = decoded;
            return next();
        } catch {
            req.user = null;
            return next();
        }
    }

    req.user = null;
    next();
};
