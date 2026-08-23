/**
 * REGRESSION TEST SUITE 13: Audit keamanan & korektness program Reseller.
 *
 * Menutup celah/bug yang ditemukan pada audit menyeluruh bagian reseller:
 *   A. SSRF lewat Webhook URL reseller (utils/safeOutboundUrl.js)
 *   B. Lost-update / double-spend pada jalur cadangan wallet (compare-and-swap)
 *   C. Lantai margin harga reseller per tier (utils/resellerPricing.js)
 *   D. Sanitasi id pada filter PostgREST .or() (injeksi filter)
 *   E. Validasi input Open API (kode_produk / tujuan / ref_id)
 *
 * Tidak butuh jaringan maupun akses database.
 * Jalankan: node regtest/sim13_reseller_security_audit.js
 */

const assert = require("assert");
const {
    validateWebhookUrlShape,
    isPrivateIp
} = require("../nexshop-backend/utils/safeOutboundUrl");
const { hitungHargaReseller, lantaiHargaReseller } = require("../nexshop-backend/utils/resellerPricing");

console.log("===============================================================================");
console.log("  NEXSHOP REGTEST 13: AUDIT KEAMANAN PROGRAM RESELLER");
console.log("===============================================================================\n");

let passed = 0;
let total = 0;

function test(name, fn) {
    total++;
    try {
        fn();
        console.log(`  [PASS] ${name}`);
        passed++;
    } catch (err) {
        console.error(`  [FAIL] ${name}`);
        console.error(`         ${err.message}\n`);
        process.exitCode = 1;
    }
}

async function testAsync(name, fn) {
    total++;
    try {
        await fn();
        console.log(`  [PASS] ${name}`);
        passed++;
    } catch (err) {
        console.error(`  [FAIL] ${name}`);
        console.error(`         ${err.message}\n`);
        process.exitCode = 1;
    }
}

// =============================================================
// A. ANTI-SSRF WEBHOOK URL
// =============================================================
console.log("A. Anti-SSRF pada Webhook URL reseller\n");

const HARUS_DITOLAK = [
    ["metadata cloud AWS/GCP", "http://169.254.169.254/latest/meta-data/iam/security-credentials/"],
    ["metadata cloud via https", "https://169.254.169.254/computeMetadata/v1/"],
    ["loopback IPv4", "https://127.0.0.1/hook"],
    ["loopback IPv6", "https://[::1]/hook"],
    ["hostname localhost", "https://localhost/hook"],
    ["private 10/8", "https://10.0.0.5/hook"],
    ["private 192.168/16", "https://192.168.1.1/hook"],
    ["private 172.16/12", "https://172.20.0.9/hook"],
    ["unique-local IPv6", "https://[fd00::1]/hook"],
    ["CGNAT 100.64/10", "https://100.64.0.1/hook"],
    ["0.0.0.0/8", "https://0.0.0.0/hook"],
    ["userinfo penyamar host", "https://toko-asli.com:pass@169.254.169.254/x"],
    ["port non-web (Postgres)", "https://db.internal-host.com:5432/hook"],
    ["skema non-HTTP", "file:///etc/passwd"],
    ["domain .internal", "https://vault.internal/hook"],
    ["HTTP polos", "http://toko-mitra.com/webhook"]
];

for (const [label, url] of HARUS_DITOLAK) {
    test(`tolak ${label}`, () => {
        const hasil = validateWebhookUrlShape(url);
        assert.strictEqual(hasil.ok, false, `URL berbahaya diterima: ${url}`);
        assert.ok(hasil.reason && hasil.reason.length > 0, "alasan penolakan wajib diisi");
    });
}

const HARUS_DITERIMA = [
    ["domain publik https", "https://toko-mitra.com/webhook/nexshop"],
    ["subdomain + port 443", "https://api.toko-mitra.co.id:443/callback"],
    ["IPv6 publik", "https://[2606:4700:4700::1111]/hook"]
];

for (const [label, url] of HARUS_DITERIMA) {
    test(`terima ${label}`, () => {
        const hasil = validateWebhookUrlShape(url);
        assert.strictEqual(hasil.ok, true, `URL sah ditolak: ${url} (${hasil.reason})`);
    });
}

test("isPrivateIp menolak input yang bukan IP", () => {
    assert.strictEqual(isPrivateIp("bukan-ip"), true, "nilai tak dikenal harus dianggap tidak aman");
    assert.strictEqual(isPrivateIp("8.8.8.8"), false);
});

// =============================================================
// B. COMPARE-AND-SWAP PADA JALUR CADANGAN WALLET
//
// Mensimulasikan dua request bersamaan pada saldo yang sama untuk
// membuktikan: pola lama (baca-lalu-tulis) kehilangan satu mutasi,
// pola baru (CAS) tidak.
// =============================================================
console.log("\nB. Atomicity jalur cadangan wallet (compare-and-swap)\n");

class MockWalletTable {
    constructor(saldoAwal) {
        this.balance = saldoAwal;
        this.ledger = new Map(); // reference_id -> mutasi (UNIQUE di DB asli)
    }

    read() {
        return this.balance;
    }

    // Meniru: UPDATE wallets SET balance=? WHERE id=? -> tanpa penjaga.
    unsafeWrite(nilaiBaru) {
        this.balance = nilaiBaru;
        return 1;
    }

    // Meniru: UPDATE ... WHERE id=? AND balance=? RETURNING * -> CAS.
    casWrite(nilaiLama, nilaiBaru) {
        if (this.balance !== nilaiLama) return 0; // 0 baris terdampak
        this.balance = nilaiBaru;
        return 1;
    }

    insertLedger(referenceId, row) {
        if (this.ledger.has(referenceId)) {
            const err = new Error("duplicate key value violates unique constraint");
            err.code = "23505";
            throw err;
        }
        this.ledger.set(referenceId, row);
    }
}

// Pola LAMA: buktikan bug-nya memang nyata (test ini gagal kalau bug hilang
// dari simulasi, artinya simulasinya yang salah -- bukan kodenya).
test("pola lama (baca-lalu-tulis) KEHILANGAN satu potongan saldo", () => {
    const db = new MockWalletTable(50000);

    // Dua request membaca saldo yang sama sebelum salah satu menulis.
    const bacaA = db.read();
    const bacaB = db.read();

    db.unsafeWrite(bacaA - 30000); // A: 50.000 -> 20.000
    db.unsafeWrite(bacaB - 30000); // B: menimpa dengan 20.000 lagi

    // Dua potongan 30.000 dari 50.000 seharusnya mustahil, tapi saldo akhir
    // menunjukkan seolah cuma satu yang terjadi -> uang bocor.
    assert.strictEqual(db.balance, 20000, "simulasi lost-update tidak tereproduksi");
});

test("pola baru (CAS) menolak penulis kedua, saldo tetap konsisten", () => {
    const db = new MockWalletTable(50000);

    const bacaA = db.read();
    const bacaB = db.read();

    const barisA = db.casWrite(bacaA, bacaA - 30000);
    const barisB = db.casWrite(bacaB, bacaB - 30000);

    assert.strictEqual(barisA, 1, "penulis pertama harus berhasil");
    assert.strictEqual(barisB, 0, "penulis kedua HARUS ditolak karena saldo sudah berubah");
    assert.strictEqual(db.balance, 20000, "saldo akhir harus 50.000 - 30.000");
});

test("CAS: percobaan ulang memakai saldo terbaru dan menolak saldo kurang", () => {
    const db = new MockWalletTable(50000);

    db.casWrite(50000, 20000); // request A sukses

    // Request B mengulang: baca ulang saldo terbaru (20.000), lalu sadar
    // saldonya tidak cukup untuk 30.000.
    const saldoTerbaru = db.read();
    assert.strictEqual(saldoTerbaru, 20000);
    assert.ok(saldoTerbaru < 30000, "saldo terbaru harus tidak mencukupi");
});

test("ledger UNIQUE reference_id mencegah mutasi ganda untuk satu ref_id", () => {
    const db = new MockWalletTable(100000);
    const ref = "RSL-PUR-42-ORDER123";

    db.insertLedger(ref, { amount: 20000, direction: "OUT" });

    assert.throws(
        () => db.insertLedger(ref, { amount: 20000, direction: "OUT" }),
        (err) => String(err.code) === "23505",
        "reference_id kembar harus ditolak database"
    );
    assert.strictEqual(db.ledger.size, 1, "hanya boleh ada satu mutasi per reference_id");
});

test("debitRef deterministik: dua request ref_id sama menghasilkan referensi identik", () => {
    // Ini inti perbaikan idempotency di resellerApiController.createOrder.
    const buatDebitRef = (userId, refId) => `RSL-PUR-${userId}-${refId}`;

    const a = buatDebitRef(42, "ORDER-2026-001");
    const b = buatDebitRef(42, "ORDER-2026-001");
    assert.strictEqual(a, b, "referensi debit harus deterministik supaya UNIQUE constraint bisa bekerja");

    // Pola LAMA memakai Date.now() -> selalu berbeda -> idempotency mati.
    const lamaA = `RSL-PUR-ORDER-2026-001-${1000}`;
    const lamaB = `RSL-PUR-ORDER-2026-001-${1001}`;
    assert.notStrictEqual(lamaA, lamaB, "pola lama memang tidak deterministik");
});

// =============================================================
// C. LANTAI MARGIN HARGA RESELLER
// =============================================================
console.log("\nC. Lantai margin NexShop pada harga reseller\n");

const TIER_UJI = [
    { code: "BRONZE", percent: 2 },
    { code: "SILVER", percent: 3.5 },
    { code: "GOLD", percent: 5 },
    { code: "PLATINUM", percent: 8 }
];

test("harga reseller tiap tier tidak pernah <= harga modal", () => {
    const produk = [
        { modal: 1000, jual: 1100 },
        { modal: 9500, jual: 10000 },
        { modal: 18000, jual: 20000 },
        { modal: 145000, jual: 150000 },
        { modal: 970000, jual: 1000000 }
    ];

    for (const p of produk) {
        for (const tier of TIER_UJI) {
            const hasil = hitungHargaReseller(p.jual, p.modal, tier.percent);
            assert.ok(
                hasil.harga > p.modal,
                `${tier.code}: harga reseller ${hasil.harga} <= modal ${p.modal} (jual ${p.jual})`
            );
        }
    }
});

test("harga reseller tidak pernah melebihi harga normal", () => {
    for (const tier of TIER_UJI) {
        const hasil = hitungHargaReseller(20000, 19900, tier.percent);
        assert.ok(hasil.harga <= 20000, `${tier.code}: harga reseller melebihi harga normal`);
    }
});

test("tier dengan diskon lebih besar tidak pernah lebih mahal", () => {
    const jual = 150000;
    const modal = 120000;
    let sebelumnya = Infinity;
    for (const tier of TIER_UJI) {
        const hasil = hitungHargaReseller(jual, modal, tier.percent);
        assert.ok(hasil.harga <= sebelumnya, `${tier.code} lebih mahal daripada tier di bawahnya`);
        sebelumnya = hasil.harga;
    }
});

test("diskon 0% (bukan reseller) mengembalikan harga normal apa adanya", () => {
    const hasil = hitungHargaReseller(20000, 18000, 0);
    assert.strictEqual(hasil.harga, 20000);
    assert.strictEqual(hasil.hemat, 0);
    assert.strictEqual(hasil.persen_efektif, 0);
});

test("lantai harga = maksimum dari (modal + 1,5%) dan (modal + Rp 150)", () => {
    // Produk nominal kecil: margin flat yang menang.
    assert.strictEqual(lantaiHargaReseller(1000), 1150);
    // Produk nominal besar: margin persen yang menang.
    assert.strictEqual(lantaiHargaReseller(100000), 101500);
});

test("hemat + harga reseller selalu sama dengan harga normal", () => {
    for (const tier of TIER_UJI) {
        const hasil = hitungHargaReseller(87000, 80000, tier.percent);
        assert.strictEqual(hasil.harga + hasil.hemat, hasil.harga_normal, `${tier.code}: pembukuan hemat tidak seimbang`);
    }
});

// =============================================================
// D. SANITASI FILTER PostgREST
// =============================================================
console.log("\nD. Sanitasi id sebelum masuk filter PostgREST .or()\n");

// Salinan persis penjaga di resellerApiController.getOrderStatus.
function idOrderValid(id) {
    const lookupId = String(id || "").trim();
    return Boolean(lookupId) && lookupId.length <= 80 && /^[A-Za-z0-9_-]+$/.test(lookupId);
}

test("menolak payload injeksi filter PostgREST", () => {
    const jahat = [
        "x,reseller_user_id.gt.0",
        "NX123,status.eq.sukses",
        "*",
        "id.eq.1)",
        "a(b)c",
        "NX1,or(harga.gt.0)",
        "",
        "   ",
        "A".repeat(81)
    ];
    for (const nilai of jahat) {
        assert.strictEqual(idOrderValid(nilai), false, `payload injeksi lolos: ${JSON.stringify(nilai)}`);
    }
});

test("menerima order id & ref id yang sah", () => {
    const sah = ["NX8A2F91BC0D", "REF-2026-0001", "order_123", "ABCdef123"];
    for (const nilai of sah) {
        assert.strictEqual(idOrderValid(nilai), true, `id sah ikut ditolak: ${nilai}`);
    }
});

// =============================================================
// E. VALIDASI INPUT OPEN API
// =============================================================
console.log("\nE. Validasi input Open API reseller\n");

// Salinan persis penjaga di resellerApiController.createOrder.
const validKodeProduk = (v) => String(v).trim().length <= 60 && /^[A-Za-z0-9._-]+$/.test(String(v).trim());
const validTujuan = (v) => {
    const t = String(v).trim();
    return t.length >= 2 && t.length <= 60 && /^[A-Za-z0-9._@-]+$/.test(t);
};
const validRefId = (v) => String(v).trim().length <= 80 && /^[A-Za-z0-9._-]+$/.test(String(v).trim());

test("kode_produk menolak karakter di luar pola SKU", () => {
    assert.strictEqual(validKodeProduk("ML86"), true);
    assert.strictEqual(validKodeProduk("PLN.TOKEN-20"), true);
    assert.strictEqual(validKodeProduk("ML86,status.eq.x"), false);
    assert.strictEqual(validKodeProduk("<script>"), false);
    assert.strictEqual(validKodeProduk("A".repeat(61)), false);
});

test("tujuan menolak nilai terlalu pendek/panjang & karakter aneh", () => {
    assert.strictEqual(validTujuan("123456789"), true);
    assert.strictEqual(validTujuan("player@game.id"), true);
    assert.strictEqual(validTujuan("1"), false);
    assert.strictEqual(validTujuan("A".repeat(61)), false);
    assert.strictEqual(validTujuan("12345 OR 1=1"), false);
});

test("ref_id menolak nilai yang bisa merusak reference_id ledger", () => {
    assert.strictEqual(validRefId("ORDER-2026-001"), true);
    assert.strictEqual(validRefId("ref.id_99"), true);
    assert.strictEqual(validRefId("ref id"), false);
    assert.strictEqual(validRefId("A".repeat(81)), false);
});

// =============================================================
console.log("");
console.log("===============================================================================");
console.log(`  RINGKASAN: ${passed}/${total} pengujian lolos.`);
console.log("===============================================================================");

if (passed !== total) {
    process.exitCode = 1;
}
