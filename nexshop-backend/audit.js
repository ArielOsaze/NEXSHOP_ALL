const fs = require("fs");
const path = require("path");
require("dotenv").config();
const supabase = require("./config/db");

async function audit() {
  console.log("=== DATABASE AUDIT REPORT ===");

  let report = "";

  // 1. Audit topup_products
  console.log("\n--- Top Up Products ---");
  const { data: topup, error: topupError } = await supabase.from("topup_products").select("*");
  if (topupError) {
    console.error("Error fetching topup_products:", topupError);
  } else {
    console.log(`Total topup_products: ${topup.length}`);
    const active = topup.filter(t => t.is_active);
    const inactive = topup.filter(t => !t.is_active);
    
    const foreign = topup.filter(t => {
      const isSg = t.nama && t.nama.toUpperCase().includes(" SINGAPORE");
      const isMy = t.nama && t.nama.toUpperCase().includes(" MALAYSIA");
      const isPh = t.nama && t.nama.toUpperCase().includes(" PHILIPPINES");
      return isSg || isMy || isPh;
    });

    const TOPUP_GAME_CATEGORIES = new Set(["gaming", "voucher game"]);
    const isGame = t => TOPUP_GAME_CATEGORIES.has(String(t.kategori || "").trim().toLowerCase());

    const gaming = topup.filter(isGame);
    const nonGaming = topup.filter(t => !isGame(t));

    const missingPrice = topup.filter(t => t.harga_jual == null);
    const missingImage = topup.filter(t => !t.operator_logo && !t.item_icon);
    const missingCategory = topup.filter(t => !t.kategori);

    console.log(`Active: ${active.length}`);
    console.log(`Inactive: ${inactive.length}`);
    console.log(`Foreign: ${foreign.length}`);
    console.log(`Gaming category: ${gaming.length}`);
    console.log(`Non-gaming category: ${nonGaming.length}`);
    console.log(`Missing price: ${missingPrice.length}`);
    console.log(`Missing image: ${missingImage.length}`);
    console.log(`Missing category: ${missingCategory.length}`);
    
    console.log(`Inactive + Gaming Category (these might be the missing ones!): ${inactive.filter(isGame).length}`);

    report += "ID | Name | Category | Is Active | Price | Image\n";
    topup.forEach(t => {
      const img = t.operator_logo || t.item_icon || "NULL";
      report += `${t.id} | ${t.nama} | ${t.kategori} | ${t.is_active} | ${t.harga_jual} | ${img.substring(0, 30)}${img.length > 30 ? '...' : ''}\n`;
    });
  }

  // 2. Audit products
  console.log("\n--- Regular Products ---");
  const { data: products, error: productsError } = await supabase.from("products").select("*");
  if (productsError) {
    console.error("Error fetching products:", productsError);
  } else {
    console.log(`Total regular products: ${products.length}`);
    const activeProducts = products.filter(p => p.is_active);
    const inactiveProducts = products.filter(p => !p.is_active);
    const missingName = products.filter(p => !p.name);
    const missingPriceProd = products.filter(p => p.price == null);
    const missingImageProd = products.filter(p => !p.image);
    const missingCategoryProd = products.filter(p => !p.category);

    console.log(`Active: ${activeProducts.length}`);
    console.log(`Inactive: ${inactiveProducts.length}`);
    console.log(`Missing name: ${missingName.length}`);
    console.log(`Missing price: ${missingPriceProd.length}`);
    console.log(`Missing image: ${missingImageProd.length}`);
    console.log(`Missing category: ${missingCategoryProd.length}`);

    if (missingName.length > 0 || missingPriceProd.length > 0 || missingImageProd.length > 0) {
      console.log("\nCorrupted Regular Products:");
      console.log("ID | Name | Category | Is Active | Price | Image");
      products.forEach(p => {
        if (!p.name || p.price == null || !p.image) {
          const img = p.image || "NULL";
          console.log(`${p.id} | ${p.name} | ${p.category} | ${p.is_active} | ${p.price} | ${img.substring(0, 30)}${img.length > 30 ? '...' : ''}`);
        }
      });
    }
  }

  fs.writeFileSync("audit-report.txt", report);
  process.exit(0);
}

audit();
