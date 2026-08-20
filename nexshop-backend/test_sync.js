const catalogService = require("./services/catalogService");
const supabase = require("./config/db");

async function testSync() {
  console.log("=== SYNC REGRESSION TEST ===");
  
  // 1. Get before count
  let { count: beforeCount } = await supabase.from("topup_products").select("*", { count: 'exact', head: true }).eq('is_active', true);
  console.log(`Active products BEFORE sync: ${beforeCount}`);
  
  // 2. Run Sync
  console.log("Running catalog sync...");
  try {
      const result = await catalogService.syncFullCatalog('manual');
      console.log(`Sync success! Added: ${result.stats.added}, Updated: ${result.stats.updated}`);
  } catch (err) {
      console.error("Sync failed:", err.message);
  }
  
  // 3. Get after count
  let { count: afterCount } = await supabase.from("topup_products").select("*", { count: 'exact', head: true }).eq('is_active', true);
  console.log(`Active products AFTER sync: ${afterCount}`);
  
  const diff = afterCount - beforeCount;
  console.log(`Difference: ${diff}`);
  
  process.exit(0);
}

testSync();
