const assert = require("assert");
const { pickLatestAbandonedCheckoutRows, hasRecentAbandonedFollowup } = require("../nexshop-backend/services/waMarketingRules");

const rows = [
    { user_id: 7, sourceType: "order", id: "old-order", created_at: "2026-08-01T00:00:00.000Z" },
    { user_id: 7, sourceType: "topup_order", id: "latest-topup", created_at: "2026-08-09T00:00:00.000Z" },
    { user_id: 8, sourceType: "order", id: "user8-order", created_at: "2026-08-05T00:00:00.000Z" },
    { user_id: 8, sourceType: "order", id: "user8-latest", created_at: "2026-08-07T00:00:00.000Z" }
];

assert.deepStrictEqual(pickLatestAbandonedCheckoutRows(rows).map((row) => row.id), ["user8-latest", "latest-topup"]);
assert.strictEqual(new Set(pickLatestAbandonedCheckoutRows(rows).map((row) => row.user_id)).size, 2);
assert.strictEqual(hasRecentAbandonedFollowup({
    followups: [{ status: "sent", created_at: "2026-08-09T12:00:00.000Z" }],
    now: "2026-08-10T12:00:00.000Z"
}), true);
assert.strictEqual(hasRecentAbandonedFollowup({
    followups: [{ status: "sent", created_at: "2026-08-01T12:00:00.000Z" }],
    now: "2026-08-10T12:00:00.000Z"
}), false);

console.log("sim28_latest_abandoned_checkout_per_user: passed");
