require("dotenv").config();
const { supabase } = require("./config/db");
const catalogService = require("./services/catalogService");

async function run() {
    console.log("Starting controlled sync...");
    try {
        const result = await catalogService.syncFullCatalog("manual");
        console.log("SYNC SUCCESS!");
        console.log("Total Fetched:", result.total_found);
        console.log("Total Added:", result.stats.added);
        console.log("Total Updated:", result.stats.updated);
        console.log("Total Foreign Skipped:", result.stats.foreign);
        console.log("Total Missing/Stale:", result.stats.missing);

        // Fetch counts for specific metadata
        const { count: opCount } = await supabase.from("topup_products").select("*", { count: "exact", head: true }).not("source_operator_id", "is", null);
        const { count: catCount } = await supabase.from("topup_products").select("*", { count: "exact", head: true }).not("source_category_id", "is", null);
        const { count: jenisCount } = await supabase.from("topup_products").select("*", { count: "exact", head: true }).not("source_jenis_id", "is", null);
        
        console.log("\n--- POST SYNC AUDIT ---");
        console.log(`Products with source_operator_id: ${opCount}`);
        console.log(`Products with source_category_id: ${catCount}`);
        console.log(`Products with source_jenis_id: ${jenisCount}`);
        
    } catch (e) {
        console.error("SYNC FAILED:", e.message);
    }
    process.exit(0);
}

run();
