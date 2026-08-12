const supabase = require('../config/db');
const crypto = require('crypto');
const { processRetryDelivery } = require('../services/notificationDeliveryService');

async function processRetryPoller() {
    try {
        // 1. Recover stale sending events (lease > 5 mins)
        const fiveMinsAgo = new Date(Date.now() - 5 * 60000).toISOString();
        const { data: staleEvents } = await supabase
            .from('notification_events')
            .select('id, lock_token')
            .eq('status', 'sending')
            .lt('locked_at', fiveMinsAgo);

        if (staleEvents && staleEvents.length > 0) {
            for (const stale of staleEvents) {
                await supabase
                    .from('notification_events')
                    .update({
                        status: 'unknown',
                        last_error: 'Lease pengiriman kedaluwarsa; hasil pengiriman tidak dapat dipastikan',
                        next_retry_at: null,
                        locked_at: null,
                        lock_token: null
                    })
                    .eq('id', stale.id)
                    .eq('status', 'sending')
                    .eq('lock_token', stale.lock_token);
            }
        }

        // 2. Fetch candidates for retry
        const { data: candidates, error } = await supabase
            .from('notification_events')
            .select('id, order_id, notification_type, attempt_count')
            .eq('status', 'failed')
            .lt('attempt_count', 3)
            .lte('next_retry_at', new Date().toISOString());

        if (error || !candidates) return;

        // 3. Process each candidate via service
        for (const candidate of candidates) {
            await processRetryDelivery(candidate);
        }

    } catch (err) {
        console.error("Error in notificationRetryPoller:", err);
    }
}

function startRetryPoller() {
    // Run every 1 minute
    setInterval(processRetryPoller, 60000);
}

module.exports = {
    startRetryPoller
};
