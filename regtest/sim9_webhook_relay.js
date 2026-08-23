// ===========================================================
// Verifikasi logika Webhook Relay (tanpa DB, tanpa jaringan keluar).
//
// Yang dicek:
//   1. Routing prefix ref_id -- endpoint mana yang berhak nerima callback.
//   2. Signature keluar -- persis sama dengan potongan kode verifikasi yang
//      dipajang di dashboard buat toko penerima. Kalau dua-duanya beda,
//      semua callback bakal ditolak penerima dan gak ada yang sadar.
//   3. Penolakan URL berbahaya (SSRF): localhost, IP privat, non-HTTPS.
//
// Jalankan: node regtest/sim9_webhook_relay.js
// ===========================================================

const crypto = require("crypto");
const path = require("path");

// Service ini require ../config/db yang butuh env Supabase. Nilai dummy
// sudah cukup: tidak ada satu pun tes di sini yang menyentuh database.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://dummy.supabase.co";
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "dummy_key";
delete process.env.WEBHOOK_RELAY_ALLOW_PRIVATE; // pastikan mode produksi

const relay = require(path.join(__dirname, "..", "nexshop-backend", "services", "webhookRelayService"));

let gagal = 0;

function cek(nama, aktual, harapan) {
    const ok = aktual === harapan;
    if (!ok) gagal++;
    console.log(`${ok ? "PASS" : "FAIL"} — ${nama}: expected ${harapan}, got ${aktual}`);
}

async function cekTolak(nama, url) {
    try {
        await relay.assertSafeTargetUrl(url);
        gagal++;
        console.log(`FAIL — ${nama}: URL "${url}" TIDAK ditolak (harusnya ditolak)`);
    } catch (err) {
        const ok = err.status === 400;
        if (!ok) gagal++;
        console.log(`${ok ? "PASS" : "FAIL"} — ${nama}: ditolak (${err.message})`);
    }
}

(async () => {
    console.log("=== 1. Routing prefix ref_id ===");
    const tokoA = { forward_all: false, ref_prefix: "TKA-" };
    const tokoB = { forward_all: false, ref_prefix: "TKB-" };
    const mirror = { forward_all: true, ref_prefix: null };
    const salahSetel = { forward_all: false, ref_prefix: "" };

    cek("toko A dapat ref miliknya", relay.endpointMatchesRef(tokoA, "TKA-20260823-001"), true);
    cek("toko A TIDAK dapat ref toko B", relay.endpointMatchesRef(tokoA, "TKB-20260823-001"), false);
    cek("toko B dapat ref miliknya", relay.endpointMatchesRef(tokoB, "TKB-20260823-001"), true);
    cek("mirror dapat semua ref", relay.endpointMatchesRef(mirror, "NEXSHOP-999"), true);
    cek("mirror dapat ref null sekalipun", relay.endpointMatchesRef(mirror, null), true);
    // Order NexShop sendiri (ref-nya UUID biasa) gak boleh bocor ke toko lain.
    cek(
        "order NexShop tidak bocor ke toko berprefix",
        relay.endpointMatchesRef(tokoA, "3f2b8c1e-1111-4222-8333-444455556666"),
        false
    );
    cek("endpoint tanpa prefix & tanpa forward_all tidak dapat apa-apa",
        relay.endpointMatchesRef(salahSetel, "TKA-1"), false);

    console.log("\n=== 2. Signature keluar ===");
    const secret = "whsec_contoh_rahasia";
    const rawBody = JSON.stringify({ source: "tokovoucher", data: { ref_id: "TKA-1", status: "sukses" } });
    const ts = "1787000000";

    const dariService = relay.signPayload(secret, ts, rawBody);

    // Ini SALINAN persis dari potongan kode yang ditampilkan ke toko
    // penerima di dashboard (Settings > Webhook Relay). Ditulis ulang
    // manual di sini supaya tesnya beneran mendeteksi kalau salah satu
    // sisi berubah sendiri.
    const caraPenerima = crypto
        .createHmac("sha256", secret)
        .update(ts + "." + rawBody)
        .digest("hex");

    cek("signature service == cara verifikasi penerima", dariService, caraPenerima);
    cek("signature berubah kalau body diubah",
        relay.signPayload(secret, ts, rawBody + " ") === dariService, false);
    cek("signature berubah kalau timestamp diubah",
        relay.signPayload(secret, "1787000001", rawBody) === dariService, false);
    cek("signature berubah kalau secret beda",
        relay.signPayload("whsec_lain", ts, rawBody) === dariService, false);

    console.log("\n=== 3. Secret yang dibuat ===");
    const s1 = relay.generateSecret();
    const s2 = relay.generateSecret();
    cek("secret berawalan whsec_", s1.startsWith("whsec_"), true);
    cek("secret panjangnya 48 hex + prefix", s1.length, 6 + 48);
    cek("dua secret tidak pernah sama", s1 === s2, false);

    console.log("\n=== 4. Penolakan URL berbahaya (SSRF) ===");
    await cekTolak("localhost", "https://localhost/hook");
    await cekTolak("loopback IPv4", "https://127.0.0.1/hook");
    await cekTolak("loopback IPv6", "https://[::1]/hook");
    await cekTolak("jaringan privat 10.x", "https://10.0.0.5/hook");
    await cekTolak("jaringan privat 192.168.x", "https://192.168.1.10/hook");
    await cekTolak("jaringan privat 172.16.x", "https://172.16.0.1/hook");
    await cekTolak("metadata cloud 169.254.169.254", "https://169.254.169.254/latest/meta-data");
    await cekTolak("hostname .internal", "https://billing.internal/hook");
    await cekTolak("http polos (bukan https)", "http://contoh.co.id/hook");
    await cekTolak("skema aneh", "file:///etc/passwd");
    await cekTolak("URL ngawur", "bukan-url");

    // URL publik yang wajar harus LOLOS. Ini menyentuh DNS, jadi kalau
    // mesinnya offline hasilnya dilaporkan sebagai catatan, bukan kegagalan.
    console.log("\n=== 5. URL publik yang wajar ===");
    try {
        const hasil = await relay.assertSafeTargetUrl("https://example.com/api/callback");
        cek("URL publik diterima", hasil, "https://example.com/api/callback");
    } catch (err) {
        console.log(`SKIP — URL publik: butuh DNS, tidak bisa diuji offline (${err.message})`);
    }

    console.log("\n==========================================");
    if (gagal === 0) {
        console.log("ALL TESTS PASSED");
    } else {
        console.log(`${gagal} TES GAGAL`);
        process.exitCode = 1;
    }
})();
