import type { ActionAuth } from "@dashwise/sdk/data/auth";
import { api } from "@/lib/apiClient";

export async function getNotificationsAction(auth: ActionAuth, unread = false, count = false) {
  return api.notifications.items.getNotificationsAction({ auth, unread, count });
}

export async function getNotificationTopicsAction(auth: ActionAuth) {
  return api.notifications.items.getNotificationTopicsAction(auth);
}

export async function createNotificationTopicAction(auth: ActionAuth, title: string) {
  return api.notifications.items.createNotificationTopicAction({ auth, title });
}

export async function markNotificationsAsReadAction(auth: ActionAuth, ids: string[]) {
  return api.notifications.items.markNotificationsAsReadAction({ auth, ids });
}
