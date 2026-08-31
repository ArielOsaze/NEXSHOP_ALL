const { buildAdminGuard } = require("./adminSession");
const { rolesFor } = require("./adminRoles");

// Sensitive dashboard areas: explicitly Admin/Super Admin only.
module.exports = buildAdminGuard(rolesFor("sensitive"), "Akses ditolak, khusus Super Admin", "SUPERADMIN_REQUIRED");
