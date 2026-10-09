import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { registerDashwiseSDKConnector } from "../pb/pocketbase";
import { subscribeActivity } from "../activity";
import {
  deleteActivity,
  deleteExpiredActivities,
  getActivity,
  listActivities,
  publishActivity,
  publishIntegrationActivity,
} from "./activities";

type Row = Record<string, any> & { id: string; owner: string; occurredAt: string };

function createPocketBaseFixture() {
  const rows: Row[] = [];
  const integrations = new Map<string, { id: string; user: string; source: string }>();
  let nextId = 1;
  const calls: Array<{ collection: string; method: string; filter?: string }> = [];

  const pb = {
    collection(name: string) {
      if (name === "integrations") {
        return {
          async getOne(id: string) {
            calls.push({ collection: name, method: "getOne" });
            const integration = integrations.get(id);
            if (!integration) throw new Error("not found");
            return integration;
          },
        };
      }
      if (name !== "activities") throw new Error(`Unexpected collection ${name}`);
      return {
        async create(payload: Record<string, unknown>) {
          calls.push({ collection: name, method: "create" });
          const now = new Date().toISOString();
          const row = { ...payload, id: `activity-${nextId++}`, created: now, createdAt: now } as Row;
          rows.push(row);
          return row;
        },
        async getOne(id: string) {
          calls.push({ collection: name, method: "getOne" });
          const row = rows.find((item) => item.id === id);
          if (!row) throw new Error("not found");
          return row;
        },
        async getFirstListItem(filter: string) {
          calls.push({ collection: name, method: "getFirstListItem", filter });
          const row = rows.find((item) => filter.includes(`owner = "${item.owner}"`)
            && filter.includes(`source = "${item.source}"`)
            && filter.includes(`sourceId = "${item.sourceId ?? ""}"`)
            && filter.includes(`idempotencyKey = "${item.idempotencyKey}"`));
          if (!row) throw new Error("not found");
          return row;
        },
        async getList(page: number, perPage: number, options: { filter: string; fields?: string; sort?: string }) {
          calls.push({ collection: name, method: "getList", filter: options.filter });
          let matching = rows.filter((item) => {
            const ownerMatch = /owner = "([^"]+)"/.exec(options.filter);
            if (ownerMatch && item.owner !== ownerMatch[1]) return false;
            const sourceMatch = /source = "([^"]+)"/.exec(options.filter);
            if (sourceMatch && item.source !== sourceMatch[1]) return false;
            const typeMatch = /type = "([^"]+)"/.exec(options.filter);
            if (typeMatch && item.type !== typeMatch[1]) return false;
            const severityMatch = /severity = "([^"]+)"/.exec(options.filter);
            if (severityMatch && item.severity !== severityMatch[1]) return false;
            const before = /occurredAt < "([^"]+)"/.exec(options.filter);
            if (before && !(item.occurredAt < before[1]!)) return false;
            const from = /occurredAt >= "([^"]+)"/.exec(options.filter);
            if (from && !(item.occurredAt >= from[1]!)) return false;
            const to = /occurredAt <= "([^"]+)"/.exec(options.filter);
            if (to && !(item.occurredAt <= to[1]!)) return false;
            return true;
          });
          if (options.sort === "occurredAt") matching = matching.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
          else matching = matching.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
          const totalItems = matching.length;
          const start = (page - 1) * perPage;
          const items = matching.slice(start, start + perPage);
          return {
            page,
            perPage,
            totalItems,
            totalPages: Math.ceil(totalItems / perPage),
            items: options.fields ? items.map(({ id, owner, occurredAt }) => ({ id, owner, occurredAt })) : items,
          };
        },
        async delete(id: string) {
          calls.push({ collection: name, method: "delete" });
          const index = rows.findIndex((item) => item.id === id);
          if (index < 0) throw new Error("not found");
          rows.splice(index, 1);
        },
      };
    },
  };

  registerDashwiseSDKConnector({ getSuperuserClient: async () => pb } as never);
  return { rows, integrations, calls };
}

describe("activity persistence service", () => {
  let fixture: ReturnType<typeof createPocketBaseFixture>;
  let unsubscribe: Array<() => void>;

  beforeEach(() => {
    fixture = createPocketBaseFixture();
    unsubscribe = [];
  });

  afterEach(() => {
    for (const dispose of unsubscribe) dispose();
  });

  test("publishes with server-resolved owner and source, deduplicates, and broadcasts only to that owner", async () => {
    let ownerEvents = 0;
    let otherOwnerEvents = 0;
    unsubscribe.push(subscribeActivity("owner-a", async () => { ownerEvents += 1; }));
    unsubscribe.push(subscribeActivity("owner-b", async () => { otherOwnerEvents += 1; }));

    const input = {
      type: "service.offline",
      title: "Service offline",
      idempotencyKey: "service-123-offline",
    };
    const first = await publishActivity("owner-a", "monitoring", input, "service-123");
    const duplicate = await publishActivity("owner-a", "monitoring", input, "service-123");

    expect(first.duplicate).toBe(false);
    expect(first.activity).toMatchObject({ ownerId: "owner-a", source: "monitoring", sourceId: "service-123" });
    expect(duplicate).toMatchObject({ duplicate: true, activity: { id: first.activity.id } });
    expect(fixture.rows).toHaveLength(1);
    expect(fixture.rows[0]).toMatchObject({ owner: "owner-a", source: "monitoring", sourceId: "service-123" });
    expect(ownerEvents).toBe(1);
    expect(otherOwnerEvents).toBe(0);
  });

  test("resolves integration attribution and rejects publishing through another user's integration", async () => {
    fixture.integrations.set("integration-a", { id: "integration-a", user: "owner-a", source: "nextcloud" });

    const published = await publishIntegrationActivity("owner-a", "integration-a", {
      type: "service.offline",
      title: "Nextcloud is offline",
      eventId: "offline-1",
    });
    expect(published.activity).toMatchObject({ ownerId: "owner-a", source: "nextcloud", sourceId: "integration-a" });

    await expect(publishIntegrationActivity("owner-b", "integration-a", {
      type: "service.offline",
      title: "Spoofed producer",
    })).rejects.toMatchObject({ status: 404 });
    expect(fixture.rows).toHaveLength(1);
  });

  test("scopes get, delete, and list operations to the authenticated owner", async () => {
    const ownerA = await publishActivity("owner-a", "monitoring", { type: "service.online", title: "A" });
    const ownerB = await publishActivity("owner-b", "monitoring", { type: "service.online", title: "B" });

    expect(await getActivity("owner-a", ownerB.activity.id)).toBeNull();
    expect(await deleteActivity("owner-a", ownerB.activity.id)).toBe(false);
    expect(await getActivity("owner-a", ownerA.activity.id)).toMatchObject({ ownerId: "owner-a" });

    const page = await listActivities("owner-a", { page: 1, perPage: 10, source: "monitoring" });
    expect(page.items.map((item) => item.ownerId)).toEqual(["owner-a"]);
    expect(fixture.calls.filter((call) => call.method === "getList").at(-1)?.filter)
      .toContain('owner = "owner-a"');
  });

  test("retention deletes only expired records, broadcasts affected owners, and keeps recent events", async () => {
    const expiry = Date.now() - 5 * 24 * 60 * 60 * 1_000;
    await publishActivity("owner-a", "monitoring", {
      type: "old.event", title: "Old", occurredAt: new Date(expiry).toISOString(),
    });
    const recent = await publishActivity("owner-b", "monitoring", {
      type: "new.event", title: "Recent", occurredAt: new Date().toISOString(),
    });
    let ownerAEvents = 0;
    let ownerBEvents = 0;
    unsubscribe.push(subscribeActivity("owner-a", async () => { ownerAEvents += 1; }));
    unsubscribe.push(subscribeActivity("owner-b", async () => { ownerBEvents += 1; }));

    const result = await deleteExpiredActivities(2);
    expect(result).toEqual({ deleted: 1 });
    expect(fixture.rows.map((row) => row.id)).toEqual([recent.activity.id]);
    expect(ownerAEvents).toBe(1);
    expect(ownerBEvents).toBe(0);
  });
});
