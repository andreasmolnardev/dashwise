import {
    formatNotificationMessage,
    groupNotificationsByTopic,
    sendViaShoutrrr,
} from "./forwarding";
import {
    getActiveNotificationForwardersByTopic,
    getQueuedNotificationItems,
    markNotificationAsDone,
} from "../../../lib/data/superuser";
import { createLogger } from "../../../lib/logger";

/**
 * Process all notifications with forwardStatus="queued" and forward them
 */
const logger = createLogger("Forwarder");

export async function processQueuedNotifications() {
    try {
        // Find all notifications with forwardStatus="queued"
        const queuedNotifications = await getQueuedNotificationItems(100);

        if (queuedNotifications.length === 0) {
            logger.info("No queued notifications to process");
            return;
        }

        logger.info(`Processing ${queuedNotifications.length} queued notifications`);

        const byTopic = groupNotificationsByTopic(
            queuedNotifications as unknown as Array<{ id: string; topicId: string; content: unknown }>
        );

        // For each topic, get active forwarders and send
        for (const [topicId, notifications] of byTopic.entries()) {
            try {
                const forwarders = await getActiveNotificationForwardersByTopic(topicId);

                if (forwarders.length === 0) {
                    // No forwarders for this topic, mark as done
                    for (const notif of notifications) {
                        await markNotificationAsDone(notif.id);
                    }
                    continue;
                }

                // Send to each forwarder
                for (const notif of notifications) {
                    let successCount = 0;

                    for (const forwarder of forwarders) {
                        try {
                            const message = formatNotificationMessage(notif.content);
                            await sendViaShoutrrr(forwarder.target, message);
                            successCount++;
                            logger.debug(`Forwarded notification ${notif.id} to ${forwarder.target}`);
                        } catch (error) {
                            logger.error(`Error forwarding to ${forwarder.target}`, error);
                        }
                    }

                    // Mark as done if at least one forwarder succeeded
                    if (successCount > 0) {
                        await markNotificationAsDone(notif.id);
                    }
                }
            } catch (error) {
                logger.error(`Error processing topic ${topicId}`, error);
            }
        }
    } catch (error) {
        logger.error("Error in processQueuedNotifications", error);
    }
}
