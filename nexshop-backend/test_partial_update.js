const supabase = require("./config/db");

async function testPartialUpdate() {
  console.log("Testing partial update on products table...");
  
  // Get a product to test
  const { data: products } = await supabase.from("products").select("*").limit(1);
  if (!products || products.length === 0) {
    console.log("No regular products found to test.");
    return;
  }
  
  const testProduct = products[0];
  console.log("\n--- BEFORE ---");
  console.log(`Product ID: ${testProduct.id}`);
  console.log(`Name: ${testProduct.name}`);
  console.log(`Price: ${testProduct.price}`);
  console.log(`Image: ${testProduct.image}`);
  console.log(`Is Active: ${testProduct.is_active}`);
  
  // Test 1: Only change is_active
  const newActiveStatus = !testProduct.is_active;
  console.log(`\n--- UPDATE 1: Set is_active to ${newActiveStatus} ---`);
  
  // Mock req/res for productController
  const req1 = {
    user: { role: 'admin', email: 'test@example.com' },
    params: { id: testProduct.id },
    body: { is_active: newActiveStatus }
  };
  
  let resStatus = 0;
  let resJson = null;
  const res1 = {
    status: (s) => { resStatus = s; return res1; },
    json: (j) => { resJson = j; }
  };
  
  const productController = require("./controllers/productController");
  await productController.updateProduct(req1, res1);
  
  console.log(`Response Status: ${resStatus || 200}`);
  
  // Verify Database State
  const { data: afterUpdate1 } = await supabase.from("products").select("*").eq("id", testProduct.id).single();
  console.log("\n--- AFTER UPDATE 1 ---");
  console.log(`Name: ${afterUpdate1.name} (Should match: ${testProduct.name})`);
  console.log(`Price: ${afterUpdate1.price} (Should match: ${testProduct.price})`);
  console.log(`Image: ${afterUpdate1.image} (Should match: ${testProduct.image})`);
  console.log(`Is Active: ${afterUpdate1.is_active} (Should match: ${newActiveStatus})`);
  
  // Revert
  await supabase.from("products").update({ is_active: testProduct.is_active }).eq("id", testProduct.id);
  console.log("\nReverted to original state.");
  
  process.exit(0);
}

testPartialUpdate();
