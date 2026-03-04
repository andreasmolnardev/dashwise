import { getSuperuserPB } from "@/lib/pb";
import crypto from "crypto";

export async function listTopicTokens(userId: string) {
  const pb = await getSuperuserPB();

  const topics = await pb.collection("notificationTopics").getFullList({
    filter: `userId="${userId}"`,
  });
  if (topics.length === 0) {
    return { items: [] };
  }

  const tokens = await pb.collection("notificationTopicTokens").getFullList({
    filter: `topic.userId = "${userId}"`,
  });

  const now = new Date();
  for (const token of tokens) {
    if (token.expires && new Date(token.expires) <= now) {
      await pb.collection("notificationTopicTokens").delete(token.id);
    }
  }

  const topicsById = Object.fromEntries(
    topics.map((topic) => [topic.id, { id: topic.id, title: topic.title, userId: topic.userId }])
  );

  return {
    items: tokens.map((token: any) => ({
      id: token.id,
      token: token.token,
      topic: topicsById[token.topic] ?? { id: token.topic },
      expires: token.expires ?? null,
      created: token.created ?? null,
    })),
  };
}

export async function createTopicToken(userId: string, body: any) {
  const pb = await getSuperuserPB();
  const { topicId, topicName, expires } = body;

  let topicRecord: any = null;
  if (topicId) {
    topicRecord = await pb.collection("notificationTopics").getOne(topicId);
    if (!topicRecord || topicRecord.userId !== userId) {
      throw new Error("Topic not found or not owned by user");
    }
  } else {
    const safeName = String(topicName).replace(/"/g, '\\"');
    const topics = await pb
      .collection("notificationTopics")
      .getFullList({ filter: `userId="${userId}" && title="${safeName}"` });
    topicRecord = topics[0] ?? null;
  }

  if (!topicRecord) {
    throw new Error("Unable to resolve topic");
  }

  const rawToken = crypto.randomBytes(48).toString("hex");
  const payload: any = {
    token: rawToken,
    topic: topicRecord.id,
  };

  if (expires) {
    const expiresDate = new Date(expires);
    if (!Number.isNaN(expiresDate.getTime())) {
      payload.expires = expiresDate.toISOString();
    }
  }

  const created = await pb.collection("notificationTopicTokens").create(payload);

  return {
    item: {
      ...created,
      token: rawToken,
      topic: topicRecord,
    },
  };
}

export async function deleteTopicToken(userId: string, tokenId: string) {
  const pb = await getSuperuserPB();

  const tokenRecord = await pb.collection("notificationTopicTokens").getOne(tokenId);
  const topicRecord = await pb.collection("notificationTopics").getOne(tokenRecord.topic);
  if (!topicRecord || topicRecord.userId !== userId) {
    throw new Error("Token not found or not owned by user");
  }

  await pb.collection("notificationTopicTokens").delete(tokenId);
  return { success: true };
}
