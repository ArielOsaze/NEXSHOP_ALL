"use strict";

const resellerPortalAuthMiddleware = require("./resellerPortalAuthMiddleware");

/**
 * The public checkout route accepts both storefront sessions and guests.
 * A dedicated Portal Reseller session is different: if portal 2FA is enabled,
 * it must pass the live portal gate before it can debit the reseller wallet.
 */
module.exports = (req, res, next) => {
    if (req.user?.auth_context !== "reseller_portal") return next();
    return resellerPortalAuthMiddleware(req, res, next);
};
