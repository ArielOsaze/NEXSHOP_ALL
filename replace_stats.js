const fs = require('fs');
const path = require('path');

const targetPath = path.join(__dirname, 'nexshop-backend', 'controllers', 'statsController.js');
let content = fs.readFileSync(targetPath, 'utf8');

// Find where exports.getLeaderboard starts
const startIndex = content.indexOf('// PUBLIK — Leaderboard Top Spenders');
if (startIndex !== -1) {
    content = content.substring(0, startIndex);
}

const replacement = `// PUBLIK — Leaderboard Top Spenders
exports.getLeaderboard = async (req, res) => {
    try {
        const [ordersRes, topupRes, manualRes] = await Promise.all([
            supabase.from("orders").select("user_id, recipient_email, recipient_name, total, status").eq("status", SUCCESS_ORDER_STATUS),
            supabase.from("topup_orders").select("user_id, recipient_email, harga, status").eq("status", SUCCESS_TOPUP_STATUS),
            supabase.from("top_spenders").select("*").eq("is_active", true)
        ]);

        const manualSpenders = (manualRes.data || []).map(m => ({
            id: 'manual_' + m.id,
            name: m.display_name,
            total_spent: Number(m.total_spending || 0),
            avatar_url: m.avatar_url,
            badge: m.badge,
            rank: m.rank,
            is_manual: true
        }));

        const spenders = new Map();
        function addSpend(id, email, name, amount) {
            const key = id || email || "Guest";
            if (!spenders.has(key)) {
                spenders.set(key, { 
                    id: key, 
                    name: name || (email ? email.split('@')[0] : "Guest"), 
                    email: email,
                    total_spent: 0,
                    rank: 99, // default rank for dynamic
                    is_manual: false
                });
            }
            spenders.get(key).total_spent += Number(amount || 0);
        }

        if (!ordersRes.error) {
            (ordersRes.data || []).forEach(o => addSpend(o.user_id, o.recipient_email, o.recipient_name, o.total));
        }
        if (!topupRes.error) {
            (topupRes.data || []).forEach(t => addSpend(t.user_id, t.recipient_email, null, t.harga));
        }

        // Filter out Guest
        const dynamicSpenders = [...spenders.values()]
            .filter(u => u.id !== "Guest")
            .map(u => ({
                id: u.id,
                name: (u.name.length > 3 ? u.name.substring(0, 3) + "***" : u.name + "***"), // Mask name for dynamic
                total_spent: u.total_spent,
                avatar_url: null,
                badge: null,
                rank: 99,
                is_manual: false
            }));

        // Merge manual and dynamic. Manual entries override dynamic if names roughly match, but let's just keep both and sort.
        // To avoid duplicates, if an admin injects a name that already exists, we prefer the manual one.
        const manualNames = new Set(manualSpenders.map(m => m.name.toLowerCase()));
        const filteredDynamic = dynamicSpenders.filter(d => !manualNames.has(d.name.toLowerCase().replace('***','')));

        let leaderboard = [...manualSpenders, ...filteredDynamic];

        // Sort by rank first (ascending), then total_spent (descending)
        leaderboard.sort((a, b) => {
            if (a.rank !== b.rank) {
                return a.rank - b.rank;
            }
            return b.total_spent - a.total_spent;
        });

        res.json(leaderboard.slice(0, 10));
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server Error" });
    }
};

// ADMIN — Get all Top Spenders (Manual)
exports.getAdminLeaderboard = async (req, res) => {
    try {
        const { data, error } = await supabase.from("top_spenders").select("*").order("rank", { ascending: true }).order("created_at", { ascending: false });
        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Gagal mengambil data top spenders" });
    }
};

// ADMIN — Add Top Spender
exports.addTopSpender = async (req, res) => {
    try {
        const { display_name, total_spending, avatar_url, badge, rank, is_active } = req.body;
        if (!display_name || total_spending === undefined) {
            return res.status(400).json({ message: "Display Name dan Total Spending wajib diisi" });
        }
        
        const { data, error } = await supabase.from("top_spenders").insert([{
            display_name,
            total_spending: Number(total_spending),
            avatar_url: avatar_url || null,
            badge: badge || null,
            rank: Number(rank) || 99,
            is_active: is_active !== undefined ? is_active : true,
            source: 'manual'
        }]).select().single();

        if (error) throw error;
        res.json({ message: "Top Spender berhasil ditambahkan", data });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Gagal menambah Top Spender" });
    }
};

// ADMIN — Update Top Spender
exports.updateTopSpender = async (req, res) => {
    try {
        const { id } = req.params;
        const { display_name, total_spending, avatar_url, badge, rank, is_active } = req.body;
        
        const updates = {};
        if (display_name !== undefined) updates.display_name = display_name;
        if (total_spending !== undefined) updates.total_spending = Number(total_spending);
        if (avatar_url !== undefined) updates.avatar_url = avatar_url || null;
        if (badge !== undefined) updates.badge = badge || null;
        if (rank !== undefined) updates.rank = Number(rank);
        if (is_active !== undefined) updates.is_active = is_active;
        updates.updated_at = new Date().toISOString();

        const { data, error } = await supabase.from("top_spenders").update(updates).eq("id", id).select().single();

        if (error) throw error;
        res.json({ message: "Top Spender berhasil diupdate", data });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Gagal mengupdate Top Spender" });
    }
};

// ADMIN — Delete Top Spender
exports.deleteTopSpender = async (req, res) => {
    try {
        const { id } = req.params;
        const { error } = await supabase.from("top_spenders").delete().eq("id", id);
        if (error) throw error;
        res.json({ message: "Top Spender berhasil dihapus" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Gagal menghapus Top Spender" });
    }
};
`;

fs.writeFileSync(targetPath, content + replacement);
console.log("Replaced statsController.js");
