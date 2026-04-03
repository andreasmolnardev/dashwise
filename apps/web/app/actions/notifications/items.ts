"use server";

import { ActionAuth, requireUserAuth } from "@dashwise/sdk/data/auth";
import {
  createNotificationTopic,
  getNotifications,
  getNotificationTopics,
  markNotificationsAsRead,
} from "@dashwise/sdk/data/notifications/items";

export async function getNotificationsAction(
  auth: ActionAuth,
  unread = false,
  count = false
) {
  const { userId } = await requireUserAuth(auth);
  return getNotifications(userId, unread, count);
}

export async function getNotificationTopicsAction(auth: ActionAuth) {
  const { userId } = await requireUserAuth(auth);
  return getNotificationTopics(userId);
}

export async function createNotificationTopicAction(auth: ActionAuth, title: string) {
  const { userId } = await requireUserAuth(auth);
  return createNotificationTopic(userId, title);
}

export async function markNotificationsAsReadAction(auth: ActionAuth, ids: string[]) {
  const { userId } = await requireUserAuth(auth);
  return markNotificationsAsRead(userId, ids);
}
