import { getSuperuserPB } from "../../pb/pocketbase";
import { config } from "../../config";
import type {
  NotificationForwardersResponse,
  NotificationItemsResponse,
  NotificationTopicsResponse,
  NotificationTopicTokensResponse,
} from "@dashwise/types";

export async function getNotifications(userId: string, unread = false, count = false) {
  const pb = await getSuperuserPB();

  const topics = (await pb.collection("notificationTopics").getFullList({
    filter: `userId="${userId}"`,
  })) as Array<NotificationTopicsResponse>;
  const topicIds = topics.map((topic) => topic.id);

  if (topicIds.length === 0) {
    return count ? { total: 0, unread: 0 } : { items: [] };
  }

  let filter = topicIds.map((id) => `topicId="${id}"`).join(" || ");
  if (unread) {
    filter = `(${filter}) && status!="read"`;
  }

  const items = (await pb.collection("notificationItems").getFullList({
    filter,
    expand: "topicId",
    sort: "-created",
  })) as Array<NotificationItemsResponse<any>>;

  if (count) {
    return {
      total: items.length,
      unread: items.filter((item) => item.status !== "read").length,
    };
  }

  const sentItems = items.filter((item) => item.status === "sent");
  if (sentItems.length > 0) {
    await Promise.allSettled(
      sentItems.map((item) =>
        pb.collection("notificationItems").update(item.id, { status: "received" })
      )
    );

    items.forEach((item) => {
      if (item.status === "sent") {
        item.status = "received";
      }
    });
  }

  const topicMap = Object.fromEntries(topics.map((topic) => [topic.id, topic.title]));

  return {
    items: items.map((item) => {
      const topicId = typeof item.topicId === "string" ? item.topicId : null;
      return {
        id: item.id,
        content: item.content,
        status: item.status,
        created: item.created,
        topicId,
        topicName: topicId ? topicMap[topicId] ?? null : null,
      };
    }),
  };
}

export async function getNotificationTopics(userId: string) {
  const pb = await getSuperuserPB();
  const topics = await pb.collection("notificationTopics").getFullList({
    filter: `userId="${userId}"`,
  });

  return { items: topics.map((topic) => ({ id: topic.id, title: topic.title })) };
}

export async function createNotificationTopic(userId: string, title: string) {
  const pb = await getSuperuserPB();

  let existingTopic: NotificationTopicsResponse | null = null;
  try {
    existingTopic = await pb
      .collection("notificationTopics")
      .getFirstListItem(`title="${title}" && userId="${userId}"`);
  } catch {
    existingTopic = null;
  }

  if (existingTopic) {
    return { ok: true, topicId: existingTopic.id };
  }

  const created = (await pb.collection("notificationTopics").create({
    title,
    userId,
    priority: 1,
  })) as NotificationTopicsResponse;

  await pb.collection("notificationItems").create({
    topicId: created.id,
    content: "Topic has been created",
    status: "sent",
    source: "web",
  });

  return { ok: true, topicId: created.id };
}

export async function deleteNotificationTopic(userId: string, topicId: string) {
  const pb = await getSuperuserPB();

  const topicRecord = (await pb.collection("notificationTopics").getOne(topicId)) as NotificationTopicsResponse;
  if (!topicRecord || topicRecord.userId !== userId) {
    throw new Error("Topic not found or not owned by user");
  }

  const [items, tokens, forwarders] = (await Promise.all([
    pb.collection("notificationItems").getFullList({ filter: `topicId="${topicId}"` }),
    pb.collection("notificationTopicTokens").getFullList({ filter: `topic="${topicId}"` }),
    pb.collection("notificationForwarders").getFullList({ filter: `topic="${topicId}"` }),
  ])) as [Array<NotificationItemsResponse>, Array<NotificationTopicTokensResponse>, Array<NotificationForwardersResponse>];

  await Promise.allSettled([
    ...items.map((item) => pb.collection("notificationItems").delete(item.id)),
    ...tokens.map((token) => pb.collection("notificationTopicTokens").delete(token.id)),
    ...forwarders.map((forwarder) => pb.collection("notificationForwarders").delete(forwarder.id)),
  ]);

  await pb.collection("notificationTopics").delete(topicId);

  return { success: true };
}

export async function sendTestNotification(userId: string, topicId: string) {
  const pb = await getSuperuserPB();

  const topic = (await pb.collection("notificationTopics").getOne(topicId)) as NotificationTopicsResponse;
  if (topic.userId !== userId) {
    throw new Error("Unauthorized");
  }

  const item = await pb.collection("notificationItems").create({
    topicId,
    content: "This is a test notification from Dashwise.",
    status: "sent",
    source: "test",
    forwardStatus: "queued",
  });

  try {
    const jobsUrl = config.JOBS_WEBHOOK_URL;
    await fetch(jobsUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trigger: "notification-queued", itemId: item.id }),
    });
  } catch {
  }

  return { ok: true, itemId: item.id };
}

export async function markNotificationsAsRead(userId: string, ids: string[]) {
  const pb = await getSuperuserPB();
  let targetIds = ids;

  if (targetIds.length === 0) {
    const topics = (await pb.collection("notificationTopics").getFullList({
      filter: `userId="${userId}"`,
      })) as Array<NotificationTopicsResponse>;
    const topicIds = topics.map((topic) => topic.id);

    if (topicIds.length === 0) {
      return null;
    }

    const filter = topicIds.map((id) => `topicId="${id}"`).join(" || ");
    const items = (await pb.collection("notificationItems").getFullList({ filter, sort: "-created" })) as Array<NotificationItemsResponse>;
    targetIds = items.filter((item) => item.status !== "read").map((item) => item.id);

    if (targetIds.length === 0) {
      return null;
    }
  }

  await Promise.allSettled(
    targetIds.map((id) => pb.collection("notificationItems").update(id, { status: "read" }))
  );

  return null;
}

export async function sendNotification({}) {

}
