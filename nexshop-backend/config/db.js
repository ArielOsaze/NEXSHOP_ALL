const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const supabaseUrl = process.env.SUPABASE_URL || "https://dummy.supabase.co";
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || "dummy_key";

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.log("❌ SUPABASE_URL atau SUPABASE_SERVICE_KEY belum diisi di .env");
} else {
    console.log("✅ Supabase client siap (NexShop)");
}

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
