"use strict";

// Canonical dashboard roles. Keep this vocabulary aligned with users.role:
// `admin` is Super Admin; `staff` is operational Staff. `super_admin` is not
// a stored role and must never be accepted as an authorization shortcut.
const ROLE_PERMISSIONS = Object.freeze({
    dashboard: Object.freeze(["admin", "staff"]),
    operational: Object.freeze(["admin", "staff"]),
    sensitive: Object.freeze(["admin"])
});

function rolesFor(permission) {
    const roles = ROLE_PERMISSIONS[permission];
    if (!roles) throw new Error(`Unknown admin permission: ${permission}`);
    return roles;
}

function hasPermission(role, permission) {
    return rolesFor(permission).includes(role);
}

module.exports = { ROLE_PERMISSIONS, rolesFor, hasPermission };
