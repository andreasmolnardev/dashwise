import { getSuperuserPB } from "../lib/pb";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/**
 * Process all notifications with forwardStatus="queued" and forward them
 */
export async function processQueuedNotifications() {
    try {
        const pb = await getSuperuserPB();

        // Find all notifications with forwardStatus="queued"
        const queuedNotifications = await pb.collection("notificationItems").getFullList({
            filter: `forwardStatus="queued"`,
            batch: 100,
        });

        if (queuedNotifications.length === 0) {
            console.log("[Forwarder] No queued notifications to process");
            return;
        }

        console.log(`[Forwarder] Processing ${queuedNotifications.length} queued notifications`);

        // Group by topic
        const byTopic = new Map<string, any[]>();
        for (const notif of queuedNotifications) {
            if (!byTopic.has(notif.topicId)) {
                byTopic.set(notif.topicId, []);
            }
            byTopic.get(notif.topicId)!.push(notif);
        }

        // For each topic, get active forwarders and send
        for (const [topicId, notifications] of byTopic.entries()) {
            try {
                const forwarders = await pb.collection("notificationForwarders").getFullList({
                    filter: `topic="${topicId}" && isActive=true`,
                });

                if (forwarders.length === 0) {
                    // No forwarders for this topic, mark as done
                    for (const notif of notifications) {
                        await pb.collection("notificationItems").update(notif.id, {
                            forwardStatus: "done",
                        });
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
                            console.log(
                                `[Forwarder] Successfully forwarded notification ${notif.id} to ${forwarder.target}`
                            );
                        } catch (error) {
                            console.error(
                                `[Forwarder] Error forwarding to ${forwarder.target}:`,
                                error
                            );
                        }
                    }

                    // Mark as done if at least one forwarder succeeded
                    if (successCount > 0) {
                        await pb.collection("notificationItems").update(notif.id, {
                            forwardStatus: "done",
                        });
                    }
                }
            } catch (error) {
                console.error(`[Forwarder] Error processing topic ${topicId}:`, error);
            }
        }
    } catch (error) {
        console.error("[Forwarder] Error in processQueuedNotifications:", error);
    }
}

/**
 * Send message via Shoutrrr CLI
 * Uses preloaded message to prevent code injection
 * @param target - Shoutrrr target expression (e.g., "discord://webhook-url")
 * @param message - Message to send
 */
async function sendViaShoutrrr(target: string, message: string): Promise<void> {
    if (!target || typeof target !== "string" || target.length === 0) {
        throw new Error("Invalid target");
    }

    try {
        const safeTarget = target.replace(/'/g, "'\\''");
        const safeMessage = message.replace(/'/g, "'\\''");

        const { stdout, stderr } = await execAsync(
            `shoutrrr send --url '${safeTarget}' --message '${safeMessage}'`,
            {
                env: { ...process.env },
                timeout: 30000,
            }
        );

        if (stderr) {
            console.warn(`[Shoutrrr] Warning: ${stderr}`);
        }
    } catch (error: any) {
        throw new Error(`Shoutrrr send failed: ${error.message}`);
    }
}


/**
 * Escape string for safe use in shell commands
 */
function escapeShellArg(arg: string): string {
    // Remove any existing quotes and escape special characters
    return arg
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\$/g, "\\$")
        .replace(/`/g, "\\`");
}

/**
 * Format notification content for forwarding
 * @param content - The raw notification content
 * @returns Formatted message string
 */
function formatNotificationMessage(content: any): string {
    if (typeof content === "string") {
        return content;
    }

    if (typeof content === "object" && content !== null) {
        // If it has a message or title field, use that
        if (content.message) {
            return content.message;
        }
        if (content.title) {
            return content.title;
        }
        // Otherwise, convert to JSON
        return JSON.stringify(content);
    }

    return String(content);
}
