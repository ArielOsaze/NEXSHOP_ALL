const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { validateWaGatewayUrlShape, isStrictLoopbackGatewayHost } = require("../nexshop-backend/utils/waGatewayUrl");
const { syncWaGatewayRuntimeKey } = require("../nexshop-backend/utils/waGatewayRuntimeSync");

assert.equal(validateWaGatewayUrlShape("http://127.0.0.1:8080").ok, true, "gateway lokal harus boleh HTTP");
assert.equal(validateWaGatewayUrlShape("http://192.168.1.20:8080").ok, true, "gateway LAN privat harus boleh HTTP");
assert.equal(validateWaGatewayUrlShape("http://gateway.example.com:8080").ok, false, "gateway publik tidak boleh HTTP");
assert.equal(validateWaGatewayUrlShape("https://gateway.example.com").ok, true, "gateway publik HTTPS harus boleh");
assert.equal(validateWaGatewayUrlShape("http://127.0.0.1:8080/extra").ok, false, "base URL gateway tidak boleh memiliki path");
assert.equal(isStrictLoopbackGatewayHost("127.0.0.1"), true, "provisioning boleh ke IPv4 loopback");
assert.equal(isStrictLoopbackGatewayHost("localhost"), true, "provisioning boleh ke localhost");
assert.equal(isStrictLoopbackGatewayHost("192.168.1.20"), false, "provisioning tidak boleh ke host LAN lain");

const controller = fs.readFileSync(path.join(__dirname, "../nexshop-backend/controllers/settingsController.js"), "utf8");
const serverSource = fs.readFileSync(path.join(__dirname, "../nexshop-backend/server.js"), "utf8");
assert.ok(controller.includes("validateWaGatewayUrlShape"), "settings harus memakai validator gateway khusus");
assert.ok(controller.includes("provisionWaApiGatewayAdmin"), "admin harus dapat provisioning gateway tanpa edit .env");
assert.ok(controller.includes("/internal/configure"), "backend harus meneruskan provisioning hanya ke endpoint internal gateway");
assert.ok(controller.includes("isStrictLoopbackGatewayHost"), "provisioning harus dibatasi ke gateway loopback VPS");
assert.ok(!controller.includes("execSync(\"pm2 restart nexshop-wa-api\")"), "backend utama tidak boleh mengontrol PM2 gateway");
assert.ok(controller.includes("`${url}/reset`"), "reset harus diminta ke gateway sendiri");
assert.ok(serverSource.includes("syncWaGatewayRuntimeConfig"), "backend harus menyinkronkan key DB ke runtime gateway saat startup");
assert.ok(!serverSource.includes("waMarketingRoutes"), "backend tidak boleh import route yang tidak ikut repo/deploy");
assert.ok(!serverSource.includes("startWaMarketingPoller"), "backend tidak boleh memulai poller marketing yang tidak tersedia");

const gateway = fs.readFileSync(path.join(__dirname, "../wa-gateway-server/server.js"), "utf8");
assert.ok(gateway.includes('process.env.HOST || "127.0.0.1"'), "gateway harus private-by-default");
assert.ok(gateway.includes("timingSafeEqual"), "API key gateway harus timing-safe");
assert.ok(gateway.includes('app.post("/send-message"'), "campaign harus memakai endpoint pesan satuan");
assert.ok(gateway.includes('app.post("/send-media"'), "campaign foto harus memakai endpoint media");
assert.ok(gateway.includes('messages.upsert'), "gateway harus meneruskan chat inbound");
assert.ok(gateway.includes("INBOUND_WEBHOOK_URL"), "inbound webhook harus dikonfigurasi secara eksplisit");

const { createRuntimeConfigStore } = require("../wa-gateway-server/runtimeConfig");

(async () => {
    const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexshop-wa-gateway-"));
    const configPath = path.join(runtimeDir, "gateway-config.json");
    const apiKey = "nexshop-dashboard-managed-key-1234567890";

    let configureCalls = 0;
    const fakeAxios = {
        post: async (url, body, options) => {
            configureCalls += 1;
            assert.equal(url, "http://127.0.0.1:8080/internal/configure");
            assert.equal(body.apiKey, apiKey);
            assert.equal(options.timeout, 5000);
            return { data: { success: true } };
        }
    };
    const syncResult = await syncWaGatewayRuntimeKey({ url: "http://127.0.0.1:8080", key: apiKey, axiosClient: fakeAxios });
    assert.deepEqual(syncResult, { attempted: true, url: "http://127.0.0.1:8080" });
    assert.equal(configureCalls, 1, "runtime gateway harus diprovision tepat satu kali");
    await assert.rejects(
        () => syncWaGatewayRuntimeKey({ url: "https://gateway.example.com", key: apiKey, axiosClient: fakeAxios }),
        /loopback/
    );

    const configStore = createRuntimeConfigStore({ configPath });
    assert.equal(configStore.getApiKey(), "", "gateway baru tidak boleh memakai key bawaan dari source code");
    await configStore.setApiKey(apiKey);
    assert.equal(configStore.getApiKey(), apiKey, "key dari dashboard harus langsung aktif tanpa restart gateway");

    const restartedStore = createRuntimeConfigStore({ configPath });
    await restartedStore.load();
    assert.equal(restartedStore.getApiKey(), apiKey, "key dashboard harus tetap ada setelah gateway restart");
    fs.rmSync(runtimeDir, { recursive: true, force: true });

    console.log("sim22_wa_gateway_security: passed");
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
