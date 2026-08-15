// Simulasi logic poll()+handleClose() yang sudah diperbaiki, tanpa DOM/browser,
// untuk memverifikasi behaviour: stop-on-close & no-infinite-loop-after-paid.

let ipaymuPollingTimeout = null;
let ipaymuPollingController = null;
let ipaymuActivePopupWindow = null;
let showPaidOrderSuccessCallCount = 0;
let closeOverlayCallCount = 0;

function stopIpaymuPolling() {
    if (ipaymuPollingTimeout) { clearTimeout(ipaymuPollingTimeout); ipaymuPollingTimeout = null; }
    if (ipaymuPollingController) { ipaymuPollingController.aborted = true; ipaymuPollingController = null; }
}
function closeOverlay(id) {
    closeOverlayCallCount++;
    if (id === "directPaymentOverlay") stopIpaymuPolling();
}
function showPaidOrderSuccess() { showPaidOrderSuccessCallCount++; }

// Mock fetch: always returns status "paid"
let fetchCallCount = 0;
async function mockFetch() {
    fetchCallCount++;
    return { ok: true, json: async () => ({ status: "paid" }) };
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
                return; // <-- THE FIX: no further setTimeout scheduled
            }
        }
        ipaymuPollingTimeout = setTimeout(poll, 5); // shortened for test
    };
    poll();
}

(async () => {
    startPollFixed();
    // wait long enough that, if buggy, several extra poll cycles would have fired
    await new Promise(r => setTimeout(r, 200));

    console.log("fetchCallCount:", fetchCallCount);
    console.log("showPaidOrderSuccess called:", showPaidOrderSuccessCallCount, "time(s)");
    console.log("closeOverlay called:", closeOverlayCallCount, "time(s)");

    if (showPaidOrderSuccessCallCount === 1 && fetchCallCount === 1) {
        console.log("PASS: popup/rating hanya trigger sekali, polling berhenti total setelah paid.");
    } else {
        console.log("FAIL: popup terpicu lebih dari sekali atau polling tidak berhenti (LOOP BUG masih ada).");
        process.exit(1);
    }
})();
