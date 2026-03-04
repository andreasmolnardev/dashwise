import { queueNotificationForForwarding as queueInSdk } from "@dashwise/sdk/data/notifications/publish";

export async function queueNotificationForForwarding(itemId: string, topicId?: string) {
    try {
        await queueInSdk(itemId);
        console.log(`[Notification] Queued item ${itemId}${topicId ? ` (topic: ${topicId})` : ""} for forwarding`);
    } catch (error) {
        console.error("[Notification] Error in queueNotificationForForwarding:", error);
    }
}
