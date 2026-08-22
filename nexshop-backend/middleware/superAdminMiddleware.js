const { buildAdminGuard } = require("./adminSession");

// Aksi paling sensitif (API key, hapus user, ubah settings toko): khusus
// Super Admin. Sama seperti adminMiddleware, role dicek ulang ke database
// dan sesi idle ikut ditegakkan di server.
module.exports = buildAdminGuard(["admin"], "Akses ditolak, khusus Super Admin", "SUPERADMIN_REQUIRED");
