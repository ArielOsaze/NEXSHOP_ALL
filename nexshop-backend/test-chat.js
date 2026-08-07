require("dotenv").config();
const aiController = require("./controllers/aiController");
const supabase = require("./config/db");

// Mock global supabase because controllers/aiController.js probably expects it to be globally available or required.
// Oh wait, aiController requires supabase, but let's see if there are missing globals.
global.supabase = supabase;

async function test() {
    const req = {
        body: { message: "Halo nexbot", session_id: "test-123" },
        headers: { "x-session-id": "test-123" },
        user: null
    };

    const res = {
        status: function(code) {
            console.log("Status Code:", code);
            return this;
        },
        json: function(data) {
            console.log("Response JSON:", JSON.stringify(data, null, 2));
        }
    };

    await aiController.chat(req, res);
}

test().catch(console.error);
