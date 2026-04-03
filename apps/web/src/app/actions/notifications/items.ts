import type { ActionAuth } from "@dashwise/sdk/data/auth";
import { callAction } from "@/src/lib/action-client";

export async function getNotificationsAction(
  auth: ActionAuth,
  unread = false,
  count = false
) {
  return callAction("notifications/items", "getNotificationsAction", [auth, unread, count]);
}

export async function getNotificationTopicsAction(auth: ActionAuth) {
  return callAction("notifications/items", "getNotificationTopicsAction", [auth]);
}

export async function createNotificationTopicAction(auth: ActionAuth, title: string) {
  return callAction("notifications/items", "createNotificationTopicAction", [auth, title]);
}

export async function markNotificationsAsReadAction(auth: ActionAuth, ids: string[]) {
  return callAction("notifications/items", "markNotificationsAsReadAction", [auth, ids]);
}
