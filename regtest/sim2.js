// Simulasi: user menutup modal (X / backdrop / Escape -> closeOverlay) SEBELUM
// payment sukses terdeteksi. Setelah itu, order akhirnya "paid" di server.
// Fix seharusnya: polling sudah berhenti saat close, jadi showPaidOrderSuccess
// TIDAK boleh terpanggil lagi walau server sudah paid.

let ipaymuPollingTimeout = null;
let ipaymuPollingController = null;
let showPaidOrderSuccessCallCount = 0;
let paid = false; // server belum paid saat modal ditutup

function stopIpaymuPolling() {
    if (ipaymuPollingTimeout) { clearTimeout(ipaymuPollingTimeout); ipaymuPollingTimeout = null; }
    if (ipaymuPollingController) { ipaymuPollingController.aborted = true; ipaymuPollingController = null; }
}
function closeOverlay(id) {
    if (id === "directPaymentOverlay") stopIpaymuPolling(); // fix wired into closeOverlay too
}
function showPaidOrderSuccess() { showPaidOrderSuccessCallCount++; }

async function mockFetch() {
    return { ok: true, json: async () => ({ status: paid ? "paid" : "pending" }) };
}

function startPollFixed() {
    ipaymuPollingController = { aborted: false };
    const poll = async () => {
        const res = await mockFetch();
        if (res.ok) {
            const data = await res.json();
            if (data.status === "paid") {
                stopIpaymuPolling();
                closeOverlay("directPaymentOverlay");
                showPaidOrderSuccess();
                return;
            }
        }
        ipaymuPollingTimeout = setTimeout(poll, 5);
    };
    poll();
}

(async () => {
    startPollFixed();
    await new Promise(r => setTimeout(r, 20)); // let a couple pending cycles pass

    // USER CLICKS X -> closeOverlay("directPaymentOverlay") called directly
    // (simulating dpCloseBtn / backdrop click / Escape, all now route through
    // closeOverlay -> stopIpaymuPolling)
    closeOverlay("directPaymentOverlay");

    // Server confirms payment AFTER modal was closed
    paid = true;

    // Wait well beyond several would-be poll intervals
    await new Promise(r => setTimeout(r, 200));

    console.log("showPaidOrderSuccess called after close:", showPaidOrderSuccessCallCount, "time(s)");
    if (showPaidOrderSuccessCallCount === 0) {
        console.log("PASS: setelah modal ditutup (X), popup rating TIDAK muncul lagi otomatis, walau order akhirnya paid.");
    } else {
        console.log("FAIL: popup muncul lagi otomatis setelah ditutup (LOOP/REOPEN BUG masih ada).");
        process.exit(1);
    }
})();
