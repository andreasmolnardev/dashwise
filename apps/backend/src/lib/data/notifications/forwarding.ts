import { execFile } from "child_process";
import { promisify } from "util";
import { config } from "../../config";

const execFileAsync = promisify(execFile);

export function formatNotificationMessage(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (typeof content === "object" && content !== null) {
    const objectContent = content as Record<string, unknown>;
    if (typeof objectContent.message === "string" && objectContent.message.length > 0) {
      return objectContent.message;
    }
    if (typeof objectContent.title === "string" && objectContent.title.length > 0) {
      return objectContent.title;
    }
    return JSON.stringify(content);
  }

  return String(content);
}

export function groupNotificationsByTopic<T extends { topicId: string }>(items: T[]) {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    if (!grouped.has(item.topicId)) {
      grouped.set(item.topicId, []);
    }
    grouped.get(item.topicId)!.push(item);
  }
  return grouped;
}

export async function sendViaShoutrrr(target: string, message: string): Promise<void> {
  if (!target || typeof target !== "string") {
    throw new Error("Invalid target");
  }

  try {
    const { stderr } = await execFileAsync(
      config.SHOUTRRR_BINARY_PATH || "shoutrrr",
      ["send", "--url", target, "--message", message],
      { env: { ...process.env }, timeout: 30000 },
    );

    if (stderr) {
      console.warn(`[Shoutrrr] Warning: ${stderr}`);
    }
  } catch (error: any) {
    throw new Error(`Shoutrrr send failed: ${error.message}`);
  }
}
