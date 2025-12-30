import { getSuperuserPB } from "@/lib/pb";

/**
 * Queue a notification for forwarding via jobs container
 * Sets forwardStatus to "queued" on the notification item
 * @param itemId - The notification item ID
 * @param topicId - The notification topic ID
 */
export async function queueNotificationForForwarding(itemId: string, topicId: string) {
    try {
        const pb = await getSuperuserPB();
        
        // Update the notification item to mark it as queued for forwarding
        await pb.collection("notificationItems").update(itemId, {
            forwardStatus: "queued",
        });

        console.log(`[Notification] Queued item ${itemId} for forwarding`);
        
        // Trigger the jobs webhook to process forwarding (non-blocking)
        try {
            const jobsUrl = process.env.JOBS_WEBHOOK_URL || "http://jobs:3000/api/forward-notifications";
            await fetch(jobsUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ trigger: "notification-queued" }),
            }).catch(() => {
                // Silently fail if jobs service is not available - it will process on next scheduled run
            });
        } catch {
            // Jobs service may not be available, that's OK
        }
    } catch (error) {
        console.error("[Notification] Error in queueNotificationForForwarding:", error);
        // Don't throw - this is a secondary operation
    }
}
