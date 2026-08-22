const { buildAdminGuard } = require("./adminSession");

// Akses dashboard admin: cuma role admin & staff. Pengecekan role-nya
// diambil ULANG dari database (bukan dari isi JWT) plus penegakan batas
// idle sesi -- lihat penjelasan lengkapnya di adminSession.js.
module.exports = buildAdminGuard(["admin", "staff"], "Akses ditolak, butuh izin admin/staff");
