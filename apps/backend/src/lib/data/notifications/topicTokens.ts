import { getSuperuserPB } from "../../pb/pocketbase";
import { ApiActionError } from "../auth";
import crypto from "crypto";
import type { NotificationTopicsResponse, NotificationTopicTokensResponse } from "@dashwise/types";

export async function listTopicTokens(userId: string) {
  const pb = await getSuperuserPB();

  const topics = (await pb.collection("notificationTopics").getFullList({
    filter: `userId="${userId}"`,
  })) as Array<NotificationTopicsResponse>;
  if (topics.length === 0) {
    return { items: [] };
  }

  const tokens = (await pb.collection("notificationTopicTokens").getFullList({
    filter: `topic.userId = "${userId}"`,
  })) as Array<NotificationTopicTokensResponse>;

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

  let topicRecord: NotificationTopicsResponse | null = null;
  if (topicId) {
    try {
      topicRecord = (await pb.collection("notificationTopics").getOne(topicId)) as NotificationTopicsResponse;
    } catch (err) {
      console.warn(`Failed to fetch topic. topicId: ${topicId}, userId: ${userId}`, err);
      throw new ApiActionError("Topic not found", 404, { error: "Topic not found" });
    }
    if (topicRecord.userId !== userId) {
      console.warn(`Topic record not found or not owned by user. topicId: ${topicId}, userId: ${userId}`);
      throw new ApiActionError("Topic not found", 404, { error: "Topic not found" });
    }
  } else {
    const safeName = String(topicName).replace(/"/g, '\\"');
    const topics = await pb
      .collection("notificationTopics")
      .getFullList({ filter: `userId="${userId}" && title="${safeName}"` });
    topicRecord = (topics[0] as NotificationTopicsResponse | undefined) ?? null;
    if (!topicRecord) {
      throw new ApiActionError("Topic not found", 404, { error: "Topic not found" });
    }
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

  const created = (await pb.collection("notificationTopicTokens").create(payload)) as NotificationTopicTokensResponse;

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

  const tokenRecord = (await pb.collection("notificationTopicTokens").getOne(tokenId)) as NotificationTopicTokensResponse;
  const topicRecord = (await pb.collection("notificationTopics").getOne(tokenRecord.topic)) as NotificationTopicsResponse;
  if (!topicRecord || topicRecord.userId !== userId) {
    throw new Error("Token not found or not owned by user");
  }

  await pb.collection("notificationTopicTokens").delete(tokenId);
  return { success: true };
}

export async function updateTopicToken(userId: string, body: any) {
  const pb = await getSuperuserPB();
  const { tokenId, topicId, expires } = body;

  const tokenRecord = (await pb.collection("notificationTopicTokens").getOne(tokenId)) as NotificationTopicTokensResponse;
  const currentTopic = (await pb.collection("notificationTopics").getOne(tokenRecord.topic)) as NotificationTopicsResponse;
  if (!currentTopic || currentTopic.userId !== userId) {
    throw new Error("Token not found or not owned by user");
  }

  const updatePayload: Record<string, unknown> = {};
  let topicRecord = currentTopic;
  if (topicId !== undefined && topicId !== tokenRecord.topic) {
    topicRecord = (await pb.collection("notificationTopics").getOne(topicId)) as NotificationTopicsResponse;
    if (!topicRecord || topicRecord.userId !== userId) {
      throw new ApiActionError("Topic not found", 404, { error: "Topic not found" });
    }
    updatePayload.topic = topicRecord.id;
  }

  if (Object.prototype.hasOwnProperty.call(body, "expires")) {
    if (!expires) {
      updatePayload.expires = null;
    } else {
      const expiresDate = new Date(expires);
      if (Number.isNaN(expiresDate.getTime())) {
        throw new ApiActionError("Invalid expiry date", 400, { error: "Invalid expiry date" });
      }
      updatePayload.expires = expiresDate.toISOString();
    }
  }

  const updated = (await pb.collection("notificationTopicTokens").update(tokenId, updatePayload)) as NotificationTopicTokensResponse;
  return { item: { ...updated, topic: topicRecord } };
}

export async function resolveTopicToken(token: string) {
  const pb = await getSuperuserPB();
  const records = (await pb.collection("notificationTopicTokens").getFullList({
    filter: `token="${token}"`,
  })) as Array<NotificationTopicTokensResponse>;

  const tokenRecord = records[0];
  if (!tokenRecord) {
    return null;
  }

  if (tokenRecord.expires && new Date(tokenRecord.expires) <= new Date()) {
    await pb.collection("notificationTopicTokens").delete(tokenRecord.id);
    return null;
  }

  const topicRecord = (await pb.collection("notificationTopics").getOne(tokenRecord.topic)) as NotificationTopicsResponse;
  if (!topicRecord) {
    return null;
  }

  return {
    topicId: topicRecord.id,
    topicName: topicRecord.title,
    userId: topicRecord.userId,
  };
}
