const { buildAdminGuard } = require("./adminSession");
const { rolesFor } = require("./adminRoles");

// Operational dashboard: explicitly admin + staff.
module.exports = buildAdminGuard(rolesFor("operational"), "Akses ditolak, butuh izin admin/staff");
