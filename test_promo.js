const supabase = require("./nexshop-backend/config/db");
async function check() {
    const { data, error } = await supabase.from("promo_slides").select("*");
    console.log("Promo Slides:", JSON.stringify(data, null, 2));
    if (error) console.error("Error:", error);
}
check();
