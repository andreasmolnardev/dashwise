import { getServerPB, getSuperuserPB } from "@dashwise/sdk/lib/pocketbase";
import { resolveTopicToken } from "@dashwise/sdk/data/notifications/topicTokens";

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
  const createdItem = await pb.collection("notificationItems").create({
    topicId: resolved.topicId,
    content,
    status: "sent",
    source: "token",
    forwardStatus: "none",
  });

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

  let existing: Record<string, any> | null = null;
  try {
    existing = await pb.collection("notificationTopics").getFirstListItem(filter);
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

  const notificationItem = await pb.collection("notificationItems").create({
    topicId,
    content,
    status: "sent",
    source,
    forwardStatus: "none",
  });

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

  try {
    const jobsUrl = process.env.JOBS_WEBHOOK_URL || "http://jobs:3000/api/forward-notifications";
    await fetch(jobsUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trigger: "notification-queued", itemId }),
    });
  } catch {
  }
}
