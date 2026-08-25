const supabase = require("../config/db");

const PROFILE_COLUMNS = "id, fullname, email, role, avatar_url, phone, phone_normalized, phone_verified_at, onboarding_completed, google_subject, auth_provider, is_blacklisted, security_pin_hash, avatar_updated_at";

function toPublicProfile(user) {
    const isPhoneVerified = Boolean(user.phone_normalized && user.phone_verified_at);
    return {
        id: user.id,
        fullname: user.fullname,
        email: user.email,
        role: user.role,
        avatar_url: user.avatar_url,
        avatar_updated_at: user.avatar_updated_at || null,
        phone: user.phone_normalized || user.phone || null,
        phone_normalized: user.phone_normalized || null,
        phone_verified_at: user.phone_verified_at || null,
        onboarding_completed: Boolean(user.onboarding_completed)
    };
}

async function getUserProfile(userId) {
    const { data, error } = await supabase.from("users").select(PROFILE_COLUMNS).eq("id", userId).maybeSingle();
    if (error) throw error;
    return data;
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

module.exports = { PROFILE_COLUMNS, toPublicProfile, getUserProfile, getCheckoutIdentity };
