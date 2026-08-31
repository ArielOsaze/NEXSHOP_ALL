const supabase = require("../config/db");

const PROFILE_COLUMNS = "id, fullname, email, role, avatar_url, phone, phone_normalized, phone_verified_at, onboarding_completed, google_subject, auth_provider, is_blacklisted, security_pin_hash, avatar_updated_at, account_scope";

const { normalizePhoneNumber } = require("../utils/phoneNumber");

function toPublicProfile(user) {
    const canonicalPhone = user.phone_normalized || normalizePhoneNumber(user.phone || "");
    const isPhoneVerified = Boolean(canonicalPhone && user.phone_verified_at);
    return {
        id: user.id,
        fullname: user.fullname,
        email: user.email,
        role: user.role,
        avatar_url: user.avatar_url,
        avatar_updated_at: user.avatar_updated_at || null,
        phone: canonicalPhone || null,
        phone_normalized: canonicalPhone || null,
        phone_verified_at: user.phone_verified_at || null,
        has_verified_phone: isPhoneVerified,
        onboarding_completed: Boolean(user.onboarding_completed)
    };
}

async function backfillLegacyPhone(user) {
    if (!user || user.phone_normalized || !user.phone || !user.phone_verified_at) return user;
    
    const canonical = normalizePhoneNumber(user.phone);
    if (!canonical) return user;

    // Pastikan tidak ada akun lain yang sudah menggunakan nomor ini
    const { data: conflict } = await supabase
        .from("users")
        .select("id")
        .eq("phone_normalized", canonical)
        .neq("id", user.id)
        .maybeSingle();

    if (!conflict) {
        await supabase.from("users").update({ phone_normalized: canonical }).eq("id", user.id);
        user.phone_normalized = canonical;
    }
    return user;
}

async function getUserProfile(userId) {
    const { data, error } = await supabase.from("users").select(PROFILE_COLUMNS).eq("id", userId).maybeSingle();
    if (error) throw error;
    return await backfillLegacyPhone(data);
}

async function getCheckoutIdentity(userId) {
    const user = await getUserProfile(userId);
    if (!user) return { error: "USER_NOT_FOUND" };
    if (user.is_blacklisted) return { error: "USER_BLOCKED" };
    if (!user.fullname || !user.email || !user.phone_normalized || !user.phone_verified_at) {
        return { error: "PHONE_ONBOARDING_REQUIRED" };
    }
    return {
        user,
        identity: {
            name: user.fullname,
            email: user.email,
            phone: user.phone_normalized
        }
    };
}

async function getPortalCheckoutIdentity(userId) {
    const user = await getUserProfile(userId);
    if (!user) return { error: "USER_NOT_FOUND" };
    if (user.is_blacklisted) return { error: "USER_BLOCKED" };
    if (user.account_scope !== "portal_only") return { error: "PORTAL_ACCOUNT_REQUIRED" };

    // Persetujuan Admin pada pengajuan KYC adalah boundary trust Portal.
    // Nomor tujuan tetap dibaca server-side, bukan dari body browser.
    const { data: application, error } = await supabase
        .from("reseller_applications")
        .select("fullname, whatsapp, status")
        .eq("user_id", userId)
        .eq("status", "approved")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error) throw error;

    const phone = normalizePhoneNumber(application?.whatsapp || "");
    if (!application || !phone || !user.fullname || !user.email) {
        return { error: "PORTAL_CHECKOUT_IDENTITY_REQUIRED" };
    }
    return {
        user,
        identity: {
            name: user.fullname,
            email: user.email,
            phone
        }
    };
}

module.exports = { PROFILE_COLUMNS, toPublicProfile, getUserProfile, getCheckoutIdentity, getPortalCheckoutIdentity, backfillLegacyPhone };
