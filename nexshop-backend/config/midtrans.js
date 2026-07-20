const midtransClient = require("midtrans-client");
require("dotenv").config();
const { getApiKeys } = require("./settings");

// Kenapa gak bikin instance sekali di top-level (kayak sebelumnya): supaya
// Server Key/Client Key bisa diubah admin lewat Settings > API Keys tanpa
// perlu redeploy server. getApiKeys() sendiri sudah di-cache 30 detik jadi
// ini tetap murah dipanggil tiap request.
async function getSnapClient() {
    const keys = await getApiKeys();

    if (!keys.midtrans_server_key || !keys.midtrans_client_key) {
        console.log("❌ Midtrans Server/Client Key belum diisi (.env atau Settings > API Keys)");
    }

    return new midtransClient.Snap({
        isProduction: !!keys.midtrans_is_production,
        serverKey: keys.midtrans_server_key,
        clientKey: keys.midtrans_client_key
    });
}

module.exports = { getSnapClient };
