const supabase = require("./config/db");
const { normalizePhoneNumber } = require("./utils/phoneNumber");

async function run() {
    const { data: users, error } = await supabase.from("users").select("id, phone");
    if (error) {
        console.error("Error fetching users:", error);
        return;
    }

    const phoneMap = {};
    const duplicates = {};

    users.forEach(user => {
        if (!user.phone) return;
        
        const norm = normalizePhoneNumber(user.phone);
        if (!norm) return;

        if (phoneMap[norm]) {
            phoneMap[norm].push(user.id);
            duplicates[norm] = phoneMap[norm];
        } else {
            phoneMap[norm] = [user.id];
        }
    });

    if (Object.keys(duplicates).length > 0) {
        console.log("DUPLICATES_FOUND");
        console.log(JSON.stringify(duplicates, null, 2));
    } else {
        console.log("NO_DUPLICATES");
    }
}

run();
