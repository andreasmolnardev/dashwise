import { getServerPB, getSuperuserPB } from "../../pb/pocketbase";
import { broadcastActivity } from "../../activity";
import { processQueuedNotifications } from "../../../jobs/notifications/forwarder";
import { resolveTopicToken } from "./topicTokens";
import type { NotificationItemsResponse, NotificationTopicsResponse } from "@dashwise/types";

type PublishToUserTopicInput = {
  userId: string;
  topic: string;
  content: unknown;
  source?: string;
};

export async function createNotificationWithTopicToken(topicToken: string, content: unknown) {
  const resolved = await resolveTopicToken(topicToken);
  if (!resolved?.topicId) {
    return null;
  }

  const pb = await getSuperuserPB();
  const createdItem = (await pb.collection("notificationItems").create({
    topicId: resolved.topicId,
    content,
    status: "sent",
    source: "token",
    forwardStatus: "none",
  })) as NotificationItemsResponse;
  broadcastActivity(resolved.userId);
  await queueNotificationForForwarding(createdItem.id);

  return {
    topicId: resolved.topicId,
    itemId: createdItem.id,
  };
}

export async function createNotificationForUserTopic(input: PublishToUserTopicInput) {
  const { userId, topic, content, source = "web" } = input;
  const pb = getServerPB();

  const safeTopic = String(topic).replace(/"/g, '\\"');
  const filter = `title="${safeTopic}" && userId="${userId}"`;

  let existing: NotificationTopicsResponse | null = null;
  try {
    existing = (await pb.collection("notificationTopics").getFirstListItem(filter)) as NotificationTopicsResponse;
  } catch {
    existing = null;
  }

  const topicId = existing
    ? existing.id
    : (
        await pb.collection("notificationTopics").create({
          title: topic,
          userId,
          priority: 1,
        })
      ).id;

  const notificationItem = (await pb.collection("notificationItems").create({
    topicId,
    content,
    status: "sent",
    source,
    forwardStatus: "none",
  })) as NotificationItemsResponse;
  broadcastActivity(userId);
  await queueNotificationForForwarding(notificationItem.id);

  return {
    topicId,
    itemId: notificationItem.id,
  };
}

export async function createNotificationByTopicId(
  topicId: string,
  content: unknown,
  source = "system",
) {
  const pb = await getSuperuserPB();
  const topicRecord = (await pb.collection("notificationTopics").getOne(topicId)) as NotificationTopicsResponse;
  const notificationItem = (await pb.collection("notificationItems").create({
    topicId,
    content,
    status: "sent",
    source,
    forwardStatus: "none",
  })) as NotificationItemsResponse;
  broadcastActivity(topicRecord.userId);
  await queueNotificationForForwarding(notificationItem.id);

  return {
    topicId,
    itemId: notificationItem.id,
  };
}

export async function queueNotificationForForwarding(itemId: string) {
  const pb = await getSuperuserPB();
  await pb.collection("notificationItems").update(itemId, {
    forwardStatus: "queued",
  });
  await processQueuedNotifications();
}
