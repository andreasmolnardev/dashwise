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
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch("/api/v1/notifications", {
      headers: Object.keys(headers).length ? headers : undefined,
      cache: "no-store",
    });

    const json = await res.json();

    if (!res.ok) {
      throw new Error(json?.error ?? `Failed to fetch notifications (${res.status})`);
    }

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
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch("/api/v1/notifications/topics", {
      headers: Object.keys(headers).length ? headers : undefined,
      cache: "no-store",
    });

    const json = await res.json();
    if (!res.ok) throw new Error(json?.error ?? `Failed to fetch topics (${res.status})`);

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
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch("/api/v1/notifications/forwarders", {
      headers: Object.keys(headers).length ? headers : undefined,
      cache: "no-store",
    });

    const json = await res.json();
    if (!res.ok) throw new Error(json?.error ?? `Failed to fetch forwarders (${res.status})`);

    if (Array.isArray(json.items)) return json.items;
    if (Array.isArray(json)) return json;
    return json.items ?? [];
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("getNotificationForwarders error", err);
    return [];
  }
}
