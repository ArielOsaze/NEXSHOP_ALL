const supabase = require("../config/db");
const { notify } = require("../config/notify");

const TRUSTED_SOURCES = {
    "IGN": ["ign.com"], "GameSpot": ["gamespot.com"], "PC Gamer": ["pcgamer.com"],
    "Eurogamer": ["eurogamer.net"], "Rock Paper Shotgun": ["rockpapershotgun.com"],
    "Xbox Wire": ["news.xbox.com"], "PlayStation Blog": ["blog.playstation.com"],
    "Steam News": ["steamcommunity.com", "store.steampowered.com"],
    "Ubisoft News": ["news.ubisoft.com", "ubisoft.com"], "EA News": ["ea.com", "news.ea.com"]
};

function asText(value, maxLength) {
    const text = typeof value === "string" ? value.trim() : "";
    return text.length <= maxLength ? text : "";
}
function parseHttpsUrl(value) {
    try {
        const url = new URL(String(value || "").trim());
        return url.protocol === "https:" ? url : null;
    } catch (err) { return null; }
}
function domainMatches(hostname, domain) {
    return hostname === domain || hostname.endsWith(`.${domain}`);
}
function validateNewsPayload(body) {
    const title = asText(body.title, 180);
    const summary = asText(body.summary, 600);
    const source = asText(body.source, 80);
    const sourceUrl = parseHttpsUrl(body.source_url);
    const imageUrl = parseHttpsUrl(body.image_url);
    const publishedAt = new Date(body.published_at);
    const allowedDomains = TRUSTED_SOURCES[source];
    if (!title || !summary || !source || !sourceUrl || !imageUrl || Number.isNaN(publishedAt.getTime())) {
        return { error: "Judul, ringkasan, sumber, URL artikel, gambar, dan tanggal terbit wajib valid" };
    }
    if (!allowedDomains || !allowedDomains.some((domain) => domainMatches(sourceUrl.hostname, domain))) {
        return { error: "URL artikel harus berasal dari publisher tepercaya yang dipilih" };
    }
    return { value: {
        title, summary, source, source_url: sourceUrl.href, image_url: imageUrl.href,
        published_at: publishedAt.toISOString(),
        is_active: body.is_active === "true" || body.is_active === true,
        sort_order: Number.isInteger(Number(body.sort_order)) ? Number(body.sort_order) : 0
    } };
}

exports.getPublicNews = async (req, res) => {
    try {
        const { data, error } = await supabase.from("gaming_news")
            .select("id, title, summary, source, source_url, image_url, published_at")
            .eq("is_active", true).order("sort_order", { ascending: true })
            .order("published_at", { ascending: false }).limit(12);
        if (error) return res.status(500).json({ message: "Gagal memuat berita game" });
        res.json(data || []);
    } catch (err) {
        console.error("Gaming news public error:", err);
        res.status(500).json({ message: "Server Error" });
    }
};
exports.getAllNews = async (req, res) => {
    try {
        const { data, error } = await supabase.from("gaming_news").select("*")
            .order("sort_order", { ascending: true }).order("published_at", { ascending: false });
        if (error) return res.status(500).json({ message: "Gagal memuat berita game" });
        res.json(data || []);
    } catch (err) {
        console.error("Gaming news admin error:", err);
        res.status(500).json({ message: "Server Error" });
    }
};
exports.createNews = async (req, res) => {
    const result = validateNewsPayload(req.body || {});
    if (result.error) return res.status(400).json({ message: result.error });
    try {
        const { data, error } = await supabase.from("gaming_news").insert([result.value]).select().single();
        if (error) return res.status(500).json({ message: "Gagal menyimpan berita game" });
        notify("news", `${req.user.email} menambahkan berita game: "${data.title}"`);
        res.status(201).json({ message: "Berita game berhasil disimpan", data });
    } catch (err) {
        console.error("Gaming news create error:", err);
        res.status(500).json({ message: "Server Error" });
    }
};
exports.updateNews = async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ message: "ID berita tidak valid" });
    const result = validateNewsPayload(req.body || {});
    if (result.error) return res.status(400).json({ message: result.error });
    try {
        const { data, error } = await supabase.from("gaming_news")
            .update({ ...result.value, updated_at: new Date().toISOString() }).eq("id", id).select().single();
        if (error && error.code !== "PGRST116") return res.status(500).json({ message: "Gagal memperbarui berita game" });
        if (!data) return res.status(404).json({ message: "Berita game tidak ditemukan" });
        notify("news", `${req.user.email} memperbarui berita game: "${data.title}"`);
        res.json({ message: "Berita game berhasil diperbarui", data });
    } catch (err) {
        console.error("Gaming news update error:", err);
        res.status(500).json({ message: "Server Error" });
    }
};
exports.deleteNews = async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ message: "ID berita tidak valid" });
    try {
        const { data, error } = await supabase.from("gaming_news").delete().eq("id", id).select("title").single();
        if (error && error.code !== "PGRST116") return res.status(500).json({ message: "Gagal menghapus berita game" });
        if (!data) return res.status(404).json({ message: "Berita game tidak ditemukan" });
        notify("news", `${req.user.email} menghapus berita game: "${data.title}"`);
        res.json({ message: "Berita game berhasil dihapus" });
    } catch (err) {
        console.error("Gaming news delete error:", err);
        res.status(500).json({ message: "Server Error" });
    }
};
exports.TRUSTED_SOURCES = Object.keys(TRUSTED_SOURCES);
