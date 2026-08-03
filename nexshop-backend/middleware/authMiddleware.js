const jwt = require("jsonwebtoken");

module.exports = (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        return res.status(401).json({
            message: "Token tidak ditemukan"
        });
    }

    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) {
        return res.status(401).json({ message: "Format token tidak valid" });
    }
    const token = match[1];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({
            message: "Token tidak valid"
        });
    }
};
