const { listWhatsAppContacts, toVCard } = require("../services/whatsappContactService");

async function getContacts(req, res) {
    try {
        const contacts = await listWhatsAppContacts();
        res.setHeader("Cache-Control", "no-store");
        return res.json({ success: true, contacts, total: contacts.length });
    } catch (error) {
        console.error("Gagal memuat kontak WhatsApp:", error.message);
        return res.status(500).json({ success: false, message: "Kontak WhatsApp belum siap. Pastikan migration kontak sudah diterapkan." });
    }
}

async function exportVCard(req, res) {
    try {
        const contacts = await listWhatsAppContacts();
        const vcard = toVCard(contacts);
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Content-Type", "text/vcard; charset=utf-8");
        res.setHeader("Content-Disposition", 'attachment; filename="nexshop-whatsapp-contacts.vcf"');
        return res.send(vcard);
    } catch (error) {
        console.error("Gagal mengekspor kontak WhatsApp:", error.message);
        return res.status(500).json({ success: false, message: "Export kontak belum siap. Pastikan migration kontak sudah diterapkan." });
    }
}

module.exports = { getContacts, exportVCard };
