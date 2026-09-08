"use strict";

const assert = require("assert");
const path = require("path");
const Module = require("module");
const axios = require(path.join(__dirname, "..", "nexshop-backend", "node_modules", "axios"));

const ipaymuPath = path.join(__dirname, "..", "nexshop-backend", "config", "ipaymu.js");
const captured = [];
const originalPost = axios.post;
const originalLoad = Module._load;

Module._load = function patchedLoad(request, parent, isMain) {
    if (parent && parent.filename === ipaymuPath && request === "./settings") {
        return {
            getApiKeys: async () => ({
                ipaymu_va: "fixture-va",
                ipaymu_api_key: "fixture-api-key",
                ipaymu_is_production: false
            })
        };
    }
    return originalLoad.call(this, request, parent, isMain);
};

axios.post = async (url, body) => {
    captured.push({ url, body });
    return {
        data: {
            Status: 200,
            Data: {
                TransactionId: "fixture-transaction",
                PaymentNo: body.paymentChannel === "bca" ? "8801000000012345" : "8950800000012345",
                PaymentName: body.paymentChannel === "bca" ? "BCA Virtual Account" : "Mandiri Virtual Account",
                Channel: body.paymentChannel
            }
        }
    };
};

(async () => {
    const { createDirectPayment } = require(ipaymuPath);
    const common = {
        amount: 100000,
        buyerName: "Fixture Buyer",
        buyerEmail: "fixture@example.test",
        buyerPhone: "081234567890",
        notifyUrl: "https://example.test/api/wallet/notification"
    };

    const bca = await createDirectPayment({ ...common, referenceId: "QA-BCA", paymentMethod: "va", paymentChannel: "bca" });
    const mandiri = await createDirectPayment({ ...common, referenceId: "QA-MANDIRI", paymentMethod: "va", paymentChannel: "mandiri" });

    assert.strictEqual(captured.length, 2);
    assert.strictEqual(captured[0].body.paymentMethod, "va");
    assert.strictEqual(captured[0].body.paymentChannel, "bca");
    assert.strictEqual(captured[1].body.paymentMethod, "va");
    assert.strictEqual(captured[1].body.paymentChannel, "mandiri");
    assert.strictEqual(bca.paymentNo, "8801000000012345");
    assert.strictEqual(bca.paymentName, "BCA Virtual Account");
    assert.strictEqual(mandiri.paymentNo, "8950800000012345");
    assert.strictEqual(mandiri.paymentName, "Mandiri Virtual Account");

    console.log("PASS sim129_ipaymu_direct_va_request_contract");
})().finally(() => {
    axios.post = originalPost;
    Module._load = originalLoad;
}).catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
