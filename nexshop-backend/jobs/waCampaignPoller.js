"use strict";

const { runAbandonedCheckoutFollowups, runDueCampaigns } = require("../services/waMarketingService");

const POLL_INTERVAL_MS = Math.max(5 * 60 * 1000, Number(process.env.WA_CAMPAIGN_POLL_INTERVAL_MS || 15 * 60 * 1000));
const FIRST_RUN_DELAY_MS = 60 * 1000;
let started = false;

async function runWaCampaignPoll() {
    try {
        const followups = await runAbandonedCheckoutFollowups();
        const campaigns = await runDueCampaigns();
        if (followups.processed || campaigns.campaigns) {
            console.log(`[wa-campaign-poller] followups=${followups.processed}, campaigns=${campaigns.campaigns}, sent=${campaigns.sent}, failed=${campaigns.failed}`);
        }
    } catch (error) {
        const message = String(error?.message || "");
        if (!message.toLowerCase().includes("does not exist") && !message.toLowerCase().includes("schema cache")) {
            console.error("[wa-campaign-poller] error:", message);
        } else {
            console.warn("[wa-campaign-poller] migration 018 belum diterapkan; queue marketing dilewati.");
        }
    }
}

function startWaCampaignPoller() {
    if (started) return;
    started = true;
    setTimeout(() => {
        runWaCampaignPoll();
        setInterval(runWaCampaignPoll, POLL_INTERVAL_MS);
    }, FIRST_RUN_DELAY_MS).unref();
    console.log(`⏱️  WA campaign poller aktif (cek tiap ${Math.round(POLL_INTERVAL_MS / 60000)} menit)`);
}

module.exports = { startWaCampaignPoller, runWaCampaignPoll };
