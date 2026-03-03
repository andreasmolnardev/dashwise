export type NotificationItem = {
  id: string;
  title?: string;
  body?: string;
  created?: string | null;
  topic?: { id: string; title?: string } | null;
  [key: string]: any;
};

/**
 * Fetch notifications from the backend API.
 * Returns an array of NotificationItem or an empty array on error.
 */
export async function getNotifications(token?: string): Promise<NotificationItem[]> {
  try {
    const { get } = await import("@/lib/apiClient");
    const json = await get("/notifications", { token, cache: "no-store" });
    if (Array.isArray(json.items)) return json.items;
    if (Array.isArray(json)) return json;
    return json.items ?? [];
  } catch (err) {
    // Keep caller resilient — log and return empty list
    // eslint-disable-next-line no-console
    console.error("getNotifications error", err);
    return [];
  }
}

export default getNotifications;

export async function getNotificationTopics(token?: string): Promise<{ id: string; title?: string }[]> {
  try {
    const { get } = await import("@/lib/apiClient");
    const json = await get("/notifications/topics", { token, cache: "no-store" });
    if (Array.isArray(json.items)) return json.items;
    if (Array.isArray(json)) return json;
    return json.items ?? [];
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("getNotificationTopics error", err);
    return [];
  }
}

export async function getNotificationForwarders(token?: string): Promise<any[]> {
  try {
    const { get } = await import("@/lib/apiClient");
    const json = await get("/notifications/forwarders", { token, cache: "no-store" });
    if (Array.isArray(json.items)) return json.items;
    if (Array.isArray(json)) return json;
    return json.items ?? [];
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("getNotificationForwarders error", err);
    return [];
  }
}
