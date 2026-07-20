const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.log("❌ SUPABASE_URL atau SUPABASE_SERVICE_KEY belum diisi di .env");
} else {
    console.log("✅ Supabase client siap (NexShop)");
}

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
