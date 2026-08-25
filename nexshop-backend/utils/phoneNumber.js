/**
 * Canonical internal representation for Indonesian mobile numbers.
 *
 * The database always stores a phone number as E.164 (`+628...`). Provider
 * adapters convert that value only at their boundary; this prevents a mix of
 * 08..., 628..., and +628... from bypassing uniqueness checks.
 */
function normalizePhoneNumber(phone) {
    if (typeof phone !== "string") return "";

    const trimmed = phone.trim();
    if (!trimmed || /[^0-9+\s().-]/.test(trimmed)) return "";
    if ((trimmed.match(/\+/g) || []).length > 1 || (trimmed.includes("+") && !trimmed.startsWith("+"))) return "";

    const compact = trimmed.replace(/[\s().-]/g, "");
    let national;
    if (/^08\d{7,12}$/.test(compact)) {
        national = compact.slice(1);
    } else if (/^8\d{7,12}$/.test(compact)) {
        national = compact;
    } else if (/^628\d{7,12}$/.test(compact)) {
        national = compact.slice(2);
    } else if (/^\+628\d{7,12}$/.test(compact)) {
        national = compact.slice(3);
    } else {
        return "";
    }

    return `+62${national}`;
}

function toFonntePhone(phone) {
    const normalized = normalizePhoneNumber(phone);
    return normalized ? normalized.slice(1) : "";
}

function toIpaymuPhone(phone) {
    const normalized = normalizePhoneNumber(phone);
    return normalized ? `0${normalized.slice(3)}` : "";
}

module.exports = { normalizePhoneNumber, toFonntePhone, toIpaymuPhone };
