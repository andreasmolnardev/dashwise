import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import notificationsRoute from "./notifications.route";
import { getDashwiseSDKConnector, registerDashwiseSDKConnector } from "../lib/pb/pocketbase";

let previousConnector: ReturnType<typeof getDashwiseSDKConnector>;
beforeEach(() => { previousConnector = getDashwiseSDKConnector(); });
afterEach(() => { registerDashwiseSDKConnector(previousConnector); });

describe("notification device-session authentication", () => {
  test("requires device authentication on the root POST endpoint", async () => {
    for (const authorization of [undefined, "Basic dXNlcjpwYXNzd29yZA==", "Bearer legacy-pocketbase-token"]) {
      const response = await notificationsRoute.fetch(new Request("http://localhost/api/v1/notifications", {
        method: "POST",
        headers: authorization ? { Authorization: authorization } : undefined,
      }));
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Unauthorized" });
    }
  });
});

test("topic publication rejects Basic auth and parameterizes scoped credential lookup", async () => {
  const lookups: unknown[] = [];
  registerDashwiseSDKConnector({
    async getSuperuserClient() {
      return {
        filter(expression: string, values: unknown) {
          lookups.push({ expression, values });
          return "parameterized-topic-token";
        },
        collection(name: string) { return {
          async getFullList(options: { filter: string }) {
            expect(name).toBe("notificationTopicTokens");
            expect(options.filter).toBe("parameterized-topic-token");
            return [];
          },
        }; },
      };
    },
    createServerClient() {
      throw new Error("Password authentication must never be attempted");
    },
  } as never);
  const topic = 'unknown" || token != "';
  const response = await notificationsRoute.fetch(new Request(
    `http://localhost/api/v1/notifications/${encodeURIComponent(topic)}`,
    { method: "POST", headers: { Authorization: "Basic dXNlcjpwYXNzd29yZA==" } },
  ));
  expect(response.status).toBe(401);
  expect(lookups).toEqual([{ expression: "token = {:token}", values: { token: topic } }]);
});

test("scoped topic tokens can still publish without a device session", async () => {
  const created: unknown[] = [];
  registerDashwiseSDKConnector({
    async getSuperuserClient() {
      return {
        filter(expression: string, values: { token: string }) {
          expect(expression).toBe("token = {:token}");
          expect(values.token).toBe("scoped-token");
          return "scoped-lookup";
        },
        collection(name: string) { return {
          async getFullList() {
            return name === "notificationTopicTokens"
              ? [{ id: "credential", topic: "allowed-topic" }]
              : [];
          },
          async getOne(id: string) {
            expect(name).toBe("notificationTopics");
            expect(id).toBe("allowed-topic");
            return { id, userId: "owner", title: "Allowed" };
          },
          async create(data: unknown) { created.push(data); return { id: "published" }; },
          async update() { return {}; },
        }; },
      };
    },
    createServerClient() { throw new Error("Scoped topic publishing must not require password or device auth"); },
  } as never);
  const response = await notificationsRoute.fetch(new Request(
    "http://localhost/api/v1/notifications/scoped-token",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "hello" }) },
  ));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, topicId: "allowed-topic", itemId: "published" });
  expect(created).toEqual([{
    topicId: "allowed-topic", content: { message: "hello" },
    status: "sent", source: "token", forwardStatus: "none",
  }]);
});
