const assert = require("assert");
const {
    ABANDONED_CHECKOUT_DELAY_DAYS,
    shouldScheduleAbandonedCheckout,
    buildAbandonedCheckoutMessage,
    shouldSendCampaignToContact,
    normalizeIncomingContact,
    personalizeCampaignMessage
} = require("../nexshop-backend/services/waMarketingRules");

const now = new Date("2026-09-10T00:00:00.000Z");
const oldPending = new Date("2026-09-01T00:00:00.000Z").toISOString();

assert.strictEqual(ABANDONED_CHECKOUT_DELAY_DAYS, 7);
assert.strictEqual(shouldScheduleAbandonedCheckout({ status: "pending", createdAt: oldPending, now }), true);
assert.strictEqual(shouldScheduleAbandonedCheckout({ status: "paid", createdAt: oldPending, now }), false);
assert.strictEqual(shouldScheduleAbandonedCheckout({ status: "pending", createdAt: "2026-09-08T00:00:00.000Z", now }), false);
assert.strictEqual(shouldScheduleAbandonedCheckout({ status: "pending", createdAt: oldPending, reminderSentAt: oldPending, now }), false);

const reminder = buildAbandonedCheckoutMessage({
    name: "Ariel",
    productName: "Mobile Legends 86 Diamonds",
    orderId: "ORDER-123",
    checkoutUrl: "https://nexshop.cloud/"
});
assert.match(reminder, /Ariel/);
assert.match(reminder, /Mobile Legends 86 Diamonds/);
assert.match(reminder, /ORDER-123/);
assert.match(reminder, /https:\/\/nexshop\.cloud/);

assert.strictEqual(shouldSendCampaignToContact({ marketingOptIn: true, optedOutAt: null, lastSentAt: null, now }), true);
assert.strictEqual(shouldSendCampaignToContact({ marketingOptIn: false, optedOutAt: null, lastSentAt: null, now }), false);
assert.strictEqual(shouldSendCampaignToContact({ marketingOptIn: true, optedOutAt: oldPending, lastSentAt: null, now }), false);
assert.strictEqual(shouldSendCampaignToContact({ marketingOptIn: true, optedOutAt: null, lastSentAt: "2026-09-09T12:00:00.000Z", now, cooldownHours: 24 }), false);
assert.strictEqual(shouldSendCampaignToContact({ marketingOptIn: true, optedOutAt: null, lastSentAt: "2026-09-08T00:00:00.000Z", now, cooldownHours: 24 }), true);

const contact = normalizeIncomingContact({
    phone: "0812 3456 7890",
    pushName: "Ariel WhatsApp",
    registeredUser: { id: "u1", fullname: "Ariel", email: "ariel@example.com" }
});
assert.deepStrictEqual(contact, {
    user_id: "u1",
    phone_normalized: "6281234567890",
    display_name: "Ariel",
    email: "ariel@example.com"
});

const personalized = personalizeCampaignMessage("Halo {name}, kode {promo_code}", { display_name: "Ariel" }, "HEMAT10");
assert.strictEqual(personalized, "Halo Ariel, kode HEMAT10");

console.log("sim25_wa_marketing_contract: passed");
