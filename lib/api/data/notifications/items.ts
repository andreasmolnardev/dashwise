import { getSuperuserPB } from "@/lib/pb";

export async function getNotifications(userId: string, unread = false, count = false) {
  const pb = await getSuperuserPB();

  const topics = await pb.collection("notificationTopics").getFullList({
    filter: `userId="${userId}"`,
  });
  const topicIds = topics.map((topic) => topic.id);

  if (topicIds.length === 0) {
    return count ? { total: 0, unread: 0 } : { items: [] };
  }

  let filter = topicIds.map((id) => `topicId="${id}"`).join(" || ");
  if (unread) {
    filter = `(${filter}) && status!="read"`;
  }

  const items = await pb.collection("notificationItems").getFullList({
    filter,
    expand: "topicId",
    sort: "-created",
  });

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
      const topicId = typeof item.topicId === "string" ? item.topicId : item.topicId?.id ?? null;
      return {
        id: item.id,
        content: item.content,
        status: item.status,
        created: item.created,
        topicId,
        topicName: topicMap[topicId] ?? null,
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

  let existingTopic: any = null;
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

  const created = await pb.collection("notificationTopics").create({
    title,
    userId,
    priority: 1,
  });

  await pb.collection("notificationItems").create({
    topicId: created.id,
    content: "Topic has been created",
    status: "sent",
    source: "web",
  });

  return { ok: true, topicId: created.id };
}

export async function markNotificationsAsRead(userId: string, ids: string[]) {
  const pb = await getSuperuserPB();
  let targetIds = ids;

  if (targetIds.length === 0) {
    const topics = await pb.collection("notificationTopics").getFullList({
      filter: `userId="${userId}"`,
    });
    const topicIds = topics.map((topic) => topic.id);

    if (topicIds.length === 0) {
      return null;
    }

    const filter = topicIds.map((id) => `topicId="${id}"`).join(" || ");
    const items = await pb.collection("notificationItems").getFullList({ filter, sort: "-created" });
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


