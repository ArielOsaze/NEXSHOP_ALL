module.exports = (req, res, next) => {
    if (!req.user || !["admin", "staff"].includes(req.user.role)) {
        return res.status(403).json({
            success: false,
            message: "Akses ditolak, butuh izin admin/staff"
        });
    }
    next();
};
