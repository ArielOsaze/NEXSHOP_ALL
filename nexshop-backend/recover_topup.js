const supabase = require("./config/db");

async function analyzeAndRecover() {
  console.log("=== RECOVERY SCRIPT FOR TOP UP PRODUCTS ===\n");

  // Fetch all Top Up Products via pagination
  let allProducts = [];
  let from = 0;
  const pageSize = 1000;
  let fetchMore = true;

  while (fetchMore) {
      const { data, error } = await supabase
          .from("topup_products")
          .select("*")
          .range(from, from + pageSize - 1);
          
      if (error) {
          throw new Error("Failed to fetch products: " + error.message);
      }
      
      if (data && data.length > 0) {
          allProducts.push(...data);
          from += pageSize;
          if (data.length < pageSize) {
              fetchMore = false;
          }
      } else {
          fetchMore = false;
      }
  }

  const TARGET_CATEGORIES = new Set(["gaming", "voucher game", "mobile legends", "mobile legend kios pintar"]);
  
  const gamingProducts = allProducts.filter(p => TARGET_CATEGORIES.has(String(p.kategori || "").trim().toLowerCase()));

  console.log(`Found ${gamingProducts.length} Gaming-category products.`);
  
  const toRestore = [];
  const cannotVerify = [];
  
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  gamingProducts.forEach(p => {
      // It is valid if the upstream API says it's active AND we've seen it from upstream recently
      const lastSeen = new Date(p.source_last_seen_at);
      if (p.source_status === 'active' && lastSeen > oneWeekAgo) {
          toRestore.push(p);
      } else {
          cannotVerify.push(p);
      }
  });

  const isApply = process.argv.includes('--apply');
  const isDryRun = process.argv.includes('--dry-run') || !isApply;

  console.log(`\nValid and active in upstream API (Safe to restore): ${toRestore.length}`);
  console.log(`Cannot verify (Upstream inactive or stale): ${cannotVerify.length}`);

  if (toRestore.length > 0) {
      console.log("\nSample of products to restore:");
      console.log("ID | Code | Name | Last Seen | Upstream Status");
      toRestore.slice(0, 10).forEach(p => {
          console.log(`${p.id} | ${p.kode_produk} | ${p.nama} | ${p.source_last_seen_at} | ${p.source_status}`);
      });
      
      if (isApply) {
          // Perform restoration
          console.log("\n[APPLY] Restoring products by setting is_active = true...");
          const codesToRestore = toRestore.map(p => p.kode_produk);
          
          // Update in batches of 100
          let updatedCount = 0;
          for (let i = 0; i < codesToRestore.length; i += 100) {
              const batch = codesToRestore.slice(i, i + 100);
              const { error } = await supabase.from("topup_products").update({ is_active: true }).in("kode_produk", batch);
              if (error) {
                  console.error("Error restoring batch:", error);
              } else {
                  updatedCount += batch.length;
              }
          }
          console.log(`Successfully restored ${updatedCount} products!`);
      } else {
          console.log("\n[DRY RUN] No changes made. Run with --apply to perform restoration.");
      }
  } else {
      console.log("No products to restore.");
  }
}

analyzeAndRecover();
