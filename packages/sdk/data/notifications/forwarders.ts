import { getSuperuserPB } from "@dashwise/sdk/lib/pocketbase";
import type { NotificationForwardersResponse, NotificationTopicsResponse } from "@dashwise/types";

export async function getForwarders(userId: string) {
  const pb = await getSuperuserPB();
  const forwarders = (await pb.collection("notificationForwarders").getFullList({
    filter: `topic.userId = "${userId}"`,
  })) as Array<NotificationForwardersResponse>;

  return {
    items: forwarders.map((forwarder: any) => ({
      id: forwarder.id,
      topic: { id: forwarder.topic },
      target: forwarder.target,
      isActive: forwarder.isActive ?? true,
      created: forwarder.created ?? null,
      updated: forwarder.updated ?? null,
    })),
  };
}

export async function createForwarder(userId: string, body: any) {
  const pb = await getSuperuserPB();
  const { topic, target, isActive } = body;

  const topicRecord = (await pb.collection("notificationTopics").getOne(topic)) as NotificationTopicsResponse;
  if (!topicRecord || topicRecord.userId !== userId) {
    throw new Error("Topic not found or not owned by user");
  }

  const created = (await pb.collection("notificationForwarders").create({
    topic: topicRecord.id,
    target,
    isActive: isActive !== false,
  })) as NotificationForwardersResponse;

  return {
    item: {
      ...created,
      topic: topicRecord,
    },
  };
}

export async function updateForwarder(userId: string, body: any) {
  const pb = await getSuperuserPB();
  const { forwarderId, target, isActive } = body;

  const forwarderRecord = (await pb.collection("notificationForwarders").getOne(forwarderId)) as NotificationForwardersResponse;
  const topicRecord = (await pb.collection("notificationTopics").getOne(forwarderRecord.topic)) as NotificationTopicsResponse;
  if (!topicRecord || topicRecord.userId !== userId) {
    throw new Error("Forwarder not found or not owned by user");
  }

  const updatePayload: any = {};
  if (target !== undefined) updatePayload.target = target;
  if (isActive !== undefined) updatePayload.isActive = isActive;

  const updated = await pb.collection("notificationForwarders").update(forwarderId, updatePayload);
  return { item: updated };
}

export async function deleteForwarder(userId: string, forwarderId: string) {
  const pb = await getSuperuserPB();

  const forwarderRecord = (await pb.collection("notificationForwarders").getOne(forwarderId)) as NotificationForwardersResponse;
  const topicRecord = (await pb.collection("notificationTopics").getOne(forwarderRecord.topic)) as NotificationTopicsResponse;
  if (!topicRecord || topicRecord.userId !== userId) {
    throw new Error("Forwarder not found or not owned by user");
  }

  await pb.collection("notificationForwarders").delete(forwarderId);
  return { success: true };
}