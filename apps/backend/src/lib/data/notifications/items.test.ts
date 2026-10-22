import { describe, expect, mock, test } from "bun:test";

const notifications = [
  { id: "own-item", topicId: "own-topic", status: "received" },
  { id: "foreign-item", topicId: "foreign-topic", status: "received" },
];
const updates: Array<{ id: string; data: Record<string, unknown> }> = [];

const fakePB = {
  collection(name: string) {
    return {
      async getFullList({ filter }: { filter: string }) {
        if (name === "notificationTopics") {
          return [{ id: "own-topic", userId: "user-a" }];
        }
        if (name === "notificationItems") {
          const topicIds = [...filter.matchAll(/topicId="([^"]+)"/g)].map((match) => match[1]);
          return notifications.filter((item) => topicIds.includes(item.topicId));
        }
        throw new Error(`Unexpected collection: ${name}`);
      },
      async update(id: string, data: Record<string, unknown>) {
        updates.push({ id, data });
        const item = notifications.find((record) => record.id === id);
        if (item) item.status = String(data.status);
        return item;
      },
    };
  },
};

mock.module("../../pb/pocketbase", () => ({
  getSuperuserPB: async () => fakePB,
}));
mock.module("./publish", () => ({ queueNotificationForForwarding: async () => {} }));

const { markNotificationsAsRead } = await import("./items");

describe("markNotificationsAsRead", () => {
  test("marks a user's requested notification read without changing a foreign notification", async () => {
    updates.length = 0;
    notifications[0].status = "received";
    notifications[1].status = "received";

    await markNotificationsAsRead("user-a", ["own-item", "foreign-item"]);

    expect(updates).toEqual([{ id: "own-item", data: { status: "read" } }]);
    expect(notifications[0].status).toBe("read");
    expect(notifications[1].status).toBe("received");
  });

  test("with no IDs, marks all unread notifications in the user's topics read", async () => {
    updates.length = 0;
    notifications[0].status = "received";
    notifications[1].status = "received";

    await markNotificationsAsRead("user-a", []);

    expect(updates).toEqual([{ id: "own-item", data: { status: "read" } }]);
    expect(notifications[0].status).toBe("read");
    expect(notifications[1].status).toBe("received");
  });
});
