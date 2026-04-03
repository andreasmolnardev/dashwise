import type { ActionAuth } from "@dashwise/sdk/data/auth";
import { trpc } from "@/lib/apiClient";
const api = trpc as any;

export async function getNotificationsAction(auth: ActionAuth, unread = false, count = false) {
  return api.notifications.items.getNotificationsAction.query({ auth, unread, count });
}

export async function getNotificationTopicsAction(auth: ActionAuth) {
  return api.notifications.items.getNotificationTopicsAction.query(auth);
}

export async function createNotificationTopicAction(auth: ActionAuth, title: string) {
  return api.notifications.items.createNotificationTopicAction.mutate({ auth, title });
}

export async function markNotificationsAsReadAction(auth: ActionAuth, ids: string[]) {
  return api.notifications.items.markNotificationsAsReadAction.mutate({ auth, ids });
}
