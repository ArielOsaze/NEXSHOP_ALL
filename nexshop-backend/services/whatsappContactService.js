const supabase = require("../config/db");
const { normalizePhoneNumber } = require("../utils/phoneNumber");

const CONTACT_COLUMNS = "id, user_id, display_name, phone_e164, source, created_at, updated_at";

function normalizeDisplayName(user) {
    const fullname = String(user?.fullname || "").replace(/[\r\n]+/g, " ").trim();
    if (fullname) return fullname.slice(0, 120);
    const email = String(user?.email || "").split("@")[0].replace(/[\r\n]+/g, " ").trim();
    return (email || "NexShop User").slice(0, 120);
}

function escapeVCard(value) {
    return String(value ?? "")
        .replace(/\\/g, "\\\\")
        .replace(/;/g, "\\;")
        .replace(/,/g, "\\,")
        .replace(/\r?\n/g, "\\n");
}

function toVCard(contacts) {
    return (contacts || []).map((contact) => [
        "BEGIN:VCARD",
        "VERSION:3.0",
        `UID:nexshop-user-${escapeVCard(contact.user_id)}`,
        `FN:${escapeVCard(contact.display_name)}`,
        `N:${escapeVCard(contact.display_name)};;;;`,
        `TEL;TYPE=CELL,VOICE,WHATSAPP:${escapeVCard(contact.phone_e164)}`,
        "NOTE:Kontak WhatsApp NexShop",
        "END:VCARD"
    ].join("\r\n")).join("\r\n") + ((contacts || []).length ? "\r\n" : "");
}

async function upsertVerifiedUserContact(user) {
    const phone = normalizePhoneNumber(user?.phone_normalized || user?.phone || "");
    if (!user?.id || !phone || !user?.phone_verified_at) return null;

    const { data, error } = await supabase
        .from("whatsapp_contacts")
        .upsert([{
            user_id: user.id,
            display_name: normalizeDisplayName(user),
            phone_e164: phone,
            source: "verified_user",
            updated_at: new Date().toISOString()
        }], { onConflict: "user_id" })
        .select(CONTACT_COLUMNS)
        .maybeSingle();

    if (error) throw error;
    return data;
}

async function syncVerifiedUserContacts() {
    const { data: users, error: userError } = await supabase
        .from("users")
        .select("id, fullname, email, phone, phone_normalized, phone_verified_at")
        .not("phone_verified_at", "is", null)
        .order("id", { ascending: true });
    if (userError) throw userError;

    const rows = (users || []).map((user) => {
        const phone = normalizePhoneNumber(user.phone_normalized || user.phone || "");
        if (!phone) return null;
        return {
            user_id: user.id,
            display_name: normalizeDisplayName(user),
            phone_e164: phone,
            source: "verified_user",
            updated_at: new Date().toISOString()
        };
    }).filter(Boolean);

    if (rows.length) {
        const { error } = await supabase
            .from("whatsapp_contacts")
            .upsert(rows, { onConflict: "user_id" });
        if (error) throw error;
    }
    return rows.length;
}

async function listWhatsAppContacts() {
    await syncVerifiedUserContacts();
    const { data, error } = await supabase
        .from("whatsapp_contacts")
        .select(CONTACT_COLUMNS)
        .order("display_name", { ascending: true });
    if (error) throw error;
    return data || [];
}

module.exports = {
    CONTACT_COLUMNS,
    escapeVCard,
    listWhatsAppContacts,
    normalizeDisplayName,
    toVCard,
    syncVerifiedUserContacts,
    upsertVerifiedUserContact
};
