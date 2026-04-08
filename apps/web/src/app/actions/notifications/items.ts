import type { ActionAuth } from "@dashwise/sdk/data/auth";
import { callApiAction } from "@/lib/apiClient";

export async function getNotificationsAction(auth: ActionAuth, unread = false, count = false) {
  return callApiAction("notifications.items", "getNotificationsAction", { auth, unread, count });
}

export async function getNotificationTopicsAction(auth: ActionAuth) {
  return callApiAction("notifications.items", "getNotificationTopicsAction", auth);
}

export async function createNotificationTopicAction(auth: ActionAuth, title: string) {
  return callApiAction("notifications.items", "createNotificationTopicAction", { auth, title });
}

export async function markNotificationsAsReadAction(auth: ActionAuth, ids: string[]) {
  return callApiAction("notifications.items", "markNotificationsAsReadAction", { auth, ids });
}
