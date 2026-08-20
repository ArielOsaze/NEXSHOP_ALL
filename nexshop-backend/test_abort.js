const catalogService = require("./services/catalogService");
const supabase = require("./config/db");
const tokovoucher = require("./config/tokovoucher");

async function testAbort() {
  console.log("=== SYNC ABORT TEST ===");
  
  // Mock tokovoucher to return only 500 products
  const originalGet = tokovoucher.getFullCatalog;
  tokovoucher.getFullCatalog = async () => {
    return {
      data: {
        produk: new Array(500).fill({
          kode_produk: "TEST1",
          nama: "Test",
          price: 1000
        }),
        category: [],
        operator: [],
        jenis: []
      }
    };
  };

  try {
      await catalogService.syncFullCatalog('manual');
      console.log("FAIL: Sync did not abort!");
  } catch (err) {
      console.log("SUCCESS: Sync aborted with message:", err.message);
  }
  
  process.exit(0);
}

testAbort();
