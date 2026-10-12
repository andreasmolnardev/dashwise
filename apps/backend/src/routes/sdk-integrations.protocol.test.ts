import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { websocket } from "hono/bun";
import { hashSessionToken } from "../lib/data/sessions";
import { getShortcuts } from "../lib/data/shortcuts";
import { listActivities } from "../lib/data/activities";
import { broadcastSdkResourceRevision, subscribeSdkResourceRevisions } from "../lib/activity";
import { getSdkIntegrationDefinition, registerSdkIntegration } from "../lib/integrations-sdk/catalog";
import { startSdkIntegrationRuntime, stopSdkIntegrationRuntime } from "../lib/integrations-sdk/runtime";
import { getDashwiseSDKConnector, registerDashwiseSDKConnector } from "../lib/pb/pocketbase";
import { homeAssistant } from "../../../../packages/integrations/homeassistant/src/index";
import { MockHomeAssistantServer } from "../../../../packages/integrations/homeassistant/test/mock-homeassistant-server";
import restStatusExample from "../../../../packages/integration-example-rest/index";
import sdkIntegrationsRoute from "./sdk-integrations.route";
import activityWebSocketRoute from "./activity.websocket";

const userId = "sdk-protocol-test-user";
const token = "dws_sdk-protocol-test-token";
const source = "homeassistant";

type Row = Record<string, any> & { id: string };
type SdkResourceView = { id: string; name: string; state: string; available: boolean; apps: string[] };

function matches(row: Row, filter = "") {
  return filter.split(/\s+&&\s+/).every((clause) => {
    const match = /^([\w]+)\s*(=|>=|<=|>|<)\s*(?:"((?:\\.|[^\"])*)"|(true|false))$/.exec(clause.trim());
    if (!match) return true;
    const [, key, operator, quoted, bool] = match;
    const expected = quoted?.replace(/\\([\\"])/g, "$1") ?? bool;
    const actual = row[key!];
    switch (operator) {
      case "=": return String(actual ?? "") === expected;
      case ">=": return String(actual ?? "") >= expected!;
      case "<=": return String(actual ?? "") <= expected!;
      case ">": return String(actual ?? "") > expected!;
      case "<": return String(actual ?? "") < expected!;
      default: return false;
    }
  });
}

function createPocketBaseFixture() {
  const tables = new Map<string, Row[]>([["sessions", [{
    id: "session-record",
    user: userId,
    sessionId: "session-device",
    tokenHash: hashSessionToken(token),
    pocketbaseToken: "internal-pb-token",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    lastSeenAt: new Date().toISOString(),
  }]]]);
  let nextId = 0;
  const collection = (name: string) => {
    const rows = tables.get(name) ?? [];
    tables.set(name, rows);
    return {
      async create(data: Row) {
        const row = { ...data, id: data.id ?? `${name}-${++nextId}`, created: new Date().toISOString() };
        rows.push(row);
        return row;
      },
      async getOne(id: string) {
        const row = rows.find((candidate) => candidate.id === id);
        if (!row) throw new Error("Record not found");
        return row;
      },
      async getFirstListItem(filter: string) {
        const row = rows.find((candidate) => matches(candidate, filter));
        if (!row) throw new Error("Record not found");
        return row;
      },
      async getFullList(arg1?: number | { filter?: string }, arg2?: { filter?: string }) {
        const options = typeof arg1 === "object" ? arg1 : arg2;
        return rows.filter((row) => matches(row, options?.filter));
      },
      async getList(page: number, perPage: number, options?: { filter?: string }) {
        const filtered = rows.filter((row) => matches(row, options?.filter));
        const start = (page - 1) * perPage;
        return {
          page,
          perPage,
          totalItems: filtered.length,
          totalPages: Math.ceil(filtered.length / perPage),
          items: filtered.slice(start, start + perPage),
        };
      },
      async update(id: string, changes: Row) {
        const row = rows.find((candidate) => candidate.id === id);
        if (!row) throw new Error("Record not found");
        Object.assign(row, changes);
        return row;
      },
      async delete(id: string) {
        const index = rows.findIndex((row) => row.id === id);
        if (index < 0) throw new Error("Record not found");
        rows.splice(index, 1);
      },
    };
  };
  const connector = {
    async getSuperuserClient() { return { collection }; },
    createServerClient() {
      let storedToken = "";
      return {
        authStore: { get token() { return storedToken; }, save(value: string) { storedToken = value; } },
        collection(name: string) {
          return { async authRefresh() {
            if (name !== "users" || storedToken !== "internal-pb-token") throw new Error("Unexpected auth refresh");
            return { record: { id: userId }, token: storedToken };
          } };
        },
      };
    },
  };
  return { connector, tables };
}

async function waitForResourceState(
  request: (path: string, init?: RequestInit) => Promise<Response>,
  instanceId: string,
  expectedState: string,
) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await request(`/api/v1/sdk-integrations/instances/${instanceId}/resources?collectionId=entities`);
    const body = await response.json() as { resources?: Array<{ id: string; name: string; state: string; available: boolean; apps: string[] }> };
    const resource = body.resources?.find(({ id }) => id === "light.study");
    if (resource?.state === expectedState) return resource;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Home Assistant resource did not reach state ${expectedState}`);
}

let previousConnector: ReturnType<typeof getDashwiseSDKConnector>;
let fixture: ReturnType<typeof createPocketBaseFixture>;
let server: MockHomeAssistantServer;
let restServer: ReturnType<typeof Bun.serve> | undefined;
let activityServer: ReturnType<typeof Bun.serve> | undefined;

beforeEach(async () => {
  previousConnector = getDashwiseSDKConnector();
  fixture = createPocketBaseFixture();
  registerDashwiseSDKConnector(fixture.connector as never);
  server = new MockHomeAssistantServer();
  await server.start();
  if (!getSdkIntegrationDefinition(source)) registerSdkIntegration(homeAssistant);
  if (!getSdkIntegrationDefinition(restStatusExample.id)) registerSdkIntegration(restStatusExample);
});

afterEach(async () => {
  await stopSdkIntegrationRuntime();
  restServer?.stop(true);
  restServer = undefined;
  activityServer?.stop(true);
  activityServer = undefined;
  await server.stop();
  registerDashwiseSDKConnector(previousConnector);
});

describe("SDK integration API with a real Home Assistant WebSocket protocol fixture", () => {
  test("runs the public REST example through SDK instance creation, runtime, persistence, and Shortcut APIs", async () => {
    const restRequests: string[] = [];
    restServer = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => {
        restRequests.push(request.headers.get("authorization") ?? "");
        return new Response("ok", { status: 200 });
      },
    });

    const request = async (path: string, init: RequestInit = {}) => sdkIntegrationsRoute.fetch(new Request(`http://localhost${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    }));

    const createResponse = await request("/api/v1/sdk-integrations/instances", {
      method: "POST",
      body: JSON.stringify({
        source: restStatusExample.id,
        name: "Protocol REST status",
        config: {
          endpoint: `http://127.0.0.1:${restServer.port}/health`,
          serviceName: "Protocol REST service",
          pollIntervalSeconds: 60,
          apiKey: "rest-example-test-secret",
        },
      }),
    });
    expect(createResponse.status).toBe(200);
    const { instance } = await createResponse.json() as {
      instance: { id: string; configuredSecrets: string[] };
    };
    expect(instance.configuredSecrets).toEqual(["apiKey"]);

    let resource: SdkResourceView | undefined;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const response = await request(`/api/v1/sdk-integrations/instances/${instance.id}/resources?collectionId=endpoint`);
      const body = await response.json() as { resources?: SdkResourceView[] };
      resource = body.resources?.find(({ id }) => id === "endpoint");
      if (resource?.state === "online") break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(resource).toMatchObject({
      id: "endpoint",
      name: "Protocol REST service",
      state: "online",
      available: true,
    });
    expect(restRequests.at(-1)).toBe("Bearer rest-example-test-secret");
    const persistedResource = fixture.tables.get("sdkIntegrationResources")?.find((row) =>
      row.instance === instance.id && row.resourceCollection === "endpoint" && row.resourceId === "endpoint"
    );
    expect(persistedResource).toMatchObject({ owner: userId, revision: 1, stale: false });
    expect(persistedResource?.data).toMatchObject({ name: "Protocol REST service", state: "online", available: true });

    const shortcuts = await getShortcuts(userId);
    const shortcut = shortcuts.find((candidate) =>
      typeof candidate.action === "object" && "resourceId" in candidate.action &&
      candidate.action.resourceId === "endpoint" && candidate.type === "sdk-resource"
    );
    const servicesApp = fixture.tables.get("shortcutsApps")?.find((app) =>
      app.sourceId === `sdk:${instance.id}:services`
    );
    expect(shortcut).toMatchObject({
      name: "Protocol REST service",
      apps: [servicesApp?.id],
      action: {
        type: "sdk-resource",
        instanceId: instance.id,
        collectionId: "endpoint",
        resourceId: "endpoint",
      },
    });

    const updatedSecret = "rest-example-updated-secret";
    const updateResponse = await request(`/api/v1/sdk-integrations/instances/${instance.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        config: {
          serviceName: "Updated REST service",
          apiKey: updatedSecret,
        },
      }),
    });
    expect(updateResponse.status).toBe(200);
    const updatedBody = await updateResponse.json() as {
      instance: { config: Record<string, unknown>; configuredSecrets: string[] };
    };
    expect(updatedBody.instance.config).toMatchObject({
      endpoint: `http://127.0.0.1:${restServer.port}/health`,
      serviceName: "Updated REST service",
      pollIntervalSeconds: 60,
    });
    expect(updatedBody.instance.configuredSecrets).toEqual(["apiKey"]);
    expect(JSON.stringify(updatedBody)).not.toContain(updatedSecret);
    const storedInstance = fixture.tables.get("integrations")?.find(({ id }) => id === instance.id);
    expect(String(storedInstance?.sdkConfig)).not.toContain(updatedSecret);

    const waitForUpdatedResource = async () => {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const response = await request(`/api/v1/sdk-integrations/instances/${instance.id}/resources?collectionId=endpoint`);
        const body = await response.json() as { resources?: Array<SdkResourceView & { stale: boolean }> };
        const resource = body.resources?.find(({ id }) => id === "endpoint");
        if (resource?.name === "Updated REST service" && resource.state === "online") return resource;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error("Updated REST endpoint resource did not synchronize");
    };
    expect(await waitForUpdatedResource()).toMatchObject({
      name: "Updated REST service",
      state: "online",
      stale: false,
    });
    expect(restRequests.at(-1)).toBe(`Bearer ${updatedSecret}`);

    await stopSdkIntegrationRuntime();
    await startSdkIntegrationRuntime();
    expect(await waitForUpdatedResource()).toMatchObject({
      name: "Updated REST service",
      state: "online",
      stale: false,
    });
    expect(restRequests.at(-1)).toBe(`Bearer ${updatedSecret}`);
  });

  test("discovers, updates, reconnects, acts on, and persists resources through the SDK runtime", async () => {
    const request = async (path: string, init: RequestInit = {}) => sdkIntegrationsRoute.fetch(new Request(`http://localhost${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    }));

    const createResponse = await request("/api/v1/sdk-integrations/instances", {
      method: "POST",
      body: JSON.stringify({
        source,
        name: "Protocol Home Assistant",
        config: { url: server.url, accessToken: server.validToken },
      }),
    });
    expect(createResponse.status).toBe(200);
    const { instance } = await createResponse.json() as {
      instance: { id: string; config: Record<string, unknown>; configuredSecrets: string[] };
    };
    expect(instance.config).toEqual({ url: server.url });
    expect(instance.configuredSecrets).toEqual(["accessToken"]);

    const initialResource = await waitForResourceState(request, instance.id, "off");
    expect(initialResource).toMatchObject({
      id: "light.study",
      name: "Study lamp",
      state: "off",
      available: true,
      apps: ["entities", "lights"],
    });

    const widgetResolutionResponse = await request(
      `/api/v1/sdk-integrations/instances/${instance.id}/contributions/widget/entity-list/resolve`,
      { method: "POST", body: JSON.stringify({ config: { selectedEntities: ["light.study"] } }) },
    );
    expect(widgetResolutionResponse.status).toBe(200);
    const widgetResolution = await widgetResolutionResponse.json() as {
      data: { entities: Array<{ id: string; name: string; state: string }> };
      revisions: Array<{ instanceId: string; collectionId: string; resourceId: string; revision: number }>;
    };
    expect(widgetResolution.data.entities).toEqual([
      expect.objectContaining({ id: "light.study", name: "Study lamp", state: "off" }),
    ]);
    expect(widgetResolution.revisions).toEqual([
      expect.objectContaining({
        instanceId: instance.id,
        collectionId: "entities",
        resourceId: "light.study",
        revision: expect.any(Number),
      }),
    ]);

    const glanceableResolutionResponse = await request(
      `/api/v1/sdk-integrations/instances/${instance.id}/contributions/glanceable/connection-status/resolve`,
      { method: "POST", body: JSON.stringify({ config: {} }) },
    );
    expect(glanceableResolutionResponse.status).toBe(200);
    const glanceableResolution = await glanceableResolutionResponse.json() as {
      data: { connection: { id: string; state: string } };
      revisions: Array<{ collectionId: string; resourceId: string }>;
    };
    expect(glanceableResolution.data.connection).toMatchObject({ id: "connection", state: "connected" });
    expect(glanceableResolution.revisions).toContainEqual(expect.objectContaining({
      collectionId: "status",
      resourceId: "connection",
    }));

    const shortcuts = await getShortcuts(userId);
    const entityShortcut = shortcuts.find((shortcut) =>
      shortcut.type === "sdk-resource" &&
      typeof shortcut.action === "object" && shortcut.action.type === "sdk-resource" &&
      "resourceId" in shortcut.action && shortcut.action.resourceId === "light.study"
    );
    const entityApp = fixture.tables.get("shortcutsApps")?.find((app) => app.sourceId === `sdk:${instance.id}:entities`);
    const lightsApp = fixture.tables.get("shortcutsApps")?.find((app) => app.sourceId === `sdk:${instance.id}:lights`);
    expect(entityShortcut).toMatchObject({
      id: `sdk:${instance.id}:entities:light.study`,
      available: true,
      state: "off",
      apps: [entityApp?.id, lightsApp?.id],
    });
    expect(shortcuts.filter((shortcut) =>
      typeof shortcut.action === "object" && shortcut.action.type === "sdk-resource" &&
      "resourceId" in shortcut.action && shortcut.action.resourceId === "light.study"
    )).toHaveLength(1);

    server.emitEvent("homeassistant_stop", { context: { id: "protocol-stop-event" } });
    for (let attempt = 0; attempt < 40 && !fixture.tables.get("activities")?.length; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const activities = fixture.tables.get("activities") ?? [];
    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({
      owner: userId,
      source,
      type: "homeassistant.server.stopping",
      severity: "warning",
    });
    const globalActivityFeed = await listActivities(userId);
    expect(globalActivityFeed.items).toContainEqual(expect.objectContaining({
      source,
      type: "homeassistant.server.stopping",
      severity: "warning",
    }));

    const actionResponse = await request(`/api/v1/sdk-integrations/instances/${instance.id}/actions/toggle`, {
      method: "POST",
      body: JSON.stringify({ collectionId: "entities", resourceId: "light.study" }),
    });
    expect(actionResponse.status).toBe(200);
    expect(server.serviceCalls).toContainEqual(expect.objectContaining({
      type: "call_service",
      domain: "light",
      service: "toggle",
      target: { entity_id: "light.study" },
    }));

    const resourceRevisions: Array<{
      instanceId: string;
      collectionId: string;
      resourceId: string;
      revision: number;
      operation: "upsert" | "remove";
    }> = [];
    const unsubscribeResourceRevisions = subscribeSdkResourceRevisions(userId, (event) => resourceRevisions.push(event));
    server.replaceStates([{
      entity_id: "light.study",
      state: "on",
      attributes: { friendly_name: "Study lamp", supported_color_modes: ["brightness"] },
    }]);
    await expect(waitForResourceState(request, instance.id, "on")).resolves.toMatchObject({ state: "on" });
    const updatedWidgetResolution = await request(
      `/api/v1/sdk-integrations/instances/${instance.id}/contributions/widget/entity-list/resolve`,
      { method: "POST", body: JSON.stringify({ config: { selectedEntities: ["light.study"] } }) },
    );
    const updatedWidgetData = await updatedWidgetResolution.json() as { data: { entities: Array<{ id: string; state: string }> } };
    expect(updatedWidgetData.data.entities).toEqual([
      expect.objectContaining({ id: "light.study", state: "on" }),
    ]);
    expect(resourceRevisions).toContainEqual(expect.objectContaining({
      instanceId: instance.id,
      collectionId: "entities",
      resourceId: "light.study",
      operation: "upsert",
    }));
    unsubscribeResourceRevisions();

    await server.restart(100);
    await expect(waitForResourceState(request, instance.id, "on")).resolves.toMatchObject({ state: "on" });

    await stopSdkIntegrationRuntime();
    await startSdkIntegrationRuntime();
    const restoredResource = await waitForResourceState(request, instance.id, "on");
    expect(restoredResource).toMatchObject({
      id: "light.study",
      state: "on",
      available: true,
    });
    const restoredRecord = fixture.tables.get("sdkIntegrationResources")?.find((row) =>
      row.instance === instance.id && row.resourceCollection === "entities" && row.resourceId === "light.study"
    );
    expect(restoredRecord).toMatchObject({ owner: userId, stale: false });

    const restoredActionResponse = await request(`/api/v1/sdk-integrations/instances/${instance.id}/actions/toggle`, {
      method: "POST",
      body: JSON.stringify({ collectionId: "entities", resourceId: "light.study" }),
    });
    expect(restoredActionResponse.status).toBe(200);

    const deleteResponse = await request(`/api/v1/sdk-integrations/instances/${instance.id}`, { method: "DELETE" });
    expect(deleteResponse.status).toBe(200);
    expect(server.serviceCalls.length).toBeGreaterThan(0);
  });

  test("delivers authenticated SDK resource revisions and lifecycle Activities over the production Activity WebSocket route", async () => {
    const request = async (path: string, init: RequestInit = {}) => sdkIntegrationsRoute.fetch(new Request(`http://localhost${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    }));
    const createResponse = await request("/api/v1/sdk-integrations/instances", {
      method: "POST",
      body: JSON.stringify({ source, name: "Activity socket Home Assistant", config: { url: server.url, accessToken: server.validToken } }),
    });
    expect(createResponse.status).toBe(200);
    const { instance } = await createResponse.json() as { instance: { id: string } };
    await waitForResourceState(request, instance.id, "off");

    const app = new Hono();
    app.route("/", activityWebSocketRoute);
    activityServer = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch, websocket });

    const socket = new WebSocket(`ws://127.0.0.1:${activityServer.port}/api/v1/activity?token=${encodeURIComponent(token)}&sessionId=session-device`);
    const received: Array<Record<string, any>> = [];
    const waiters: Array<{
      predicate: (message: Record<string, any>) => boolean;
      resolve: (message: Record<string, any>) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }> = [];
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as Record<string, any>;
      received.push(message);
      for (let index = waiters.length - 1; index >= 0; index -= 1) {
        const waiter = waiters[index]!;
        if (!waiter.predicate(message)) continue;
        clearTimeout(waiter.timer);
        waiters.splice(index, 1);
        waiter.resolve(message);
      }
    });
    const waitForMessage = (predicate: (message: Record<string, any>) => boolean) => {
      const existing = received.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise<Record<string, any>>((resolve, reject) => {
        const timer = setTimeout(() => {
          const index = waiters.findIndex((waiter) => waiter.resolve === resolve);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error("Timed out waiting for Activity WebSocket message"));
        }, 3_000);
        waiters.push({ predicate, resolve, reject, timer });
      });
    };
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("Activity WebSocket connection failed")), { once: true });
    });
    await waitForMessage((message) => message.type === "activity:snapshot");

    const resource = { instanceId: instance.id, collectionId: "entities", resourceId: "light.study" };
    const unrelated = { instanceId: "another-users-instance", collectionId: "entities", resourceId: "light.study" };
    socket.send(JSON.stringify({ type: "sdk:resources:subscribe", resources: [resource, unrelated] }));
    const subscribed = await waitForMessage((message) => message.type === "sdk:resources:subscribed");
    expect(subscribed.resources).toEqual([resource]);
    const initialRevision = await waitForMessage((message) =>
      message.type === "sdk:resource-revision" && message.instanceId === instance.id && message.resourceId === "light.study",
    );
    expect(initialRevision).toMatchObject({ ...resource, operation: "upsert" });

    server.replaceStates([{
      entity_id: "light.study",
      state: "on",
      attributes: { friendly_name: "Study lamp", supported_color_modes: ["brightness"] },
    }]);
    const updatedRevision = await waitForMessage((message) =>
      message.type === "sdk:resource-revision" && message.instanceId === instance.id && message.resourceId === "light.study" && message.revision > initialRevision.revision,
    );
    expect(await waitForResourceState(request, instance.id, "on")).toMatchObject({ state: "on" });
    expect(updatedRevision.operation).toBe("upsert");

    const beforeUnrelatedRevision = received.length;
    broadcastSdkResourceRevision(userId, {
      instanceId: instance.id,
      collectionId: "entities",
      resourceId: "sensor.not-subscribed",
      revision: 1,
      operation: "upsert",
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(received.slice(beforeUnrelatedRevision).some((message) => message.resourceId === "sensor.not-subscribed")).toBe(false);

    socket.send(JSON.stringify({ type: "sdk:resources:unsubscribe", resources: [resource] }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const beforeUnsubscribedChange = received.length;
    server.replaceStates([{
      entity_id: "light.study",
      state: "off",
      attributes: { friendly_name: "Study lamp", supported_color_modes: ["brightness"] },
    }]);
    await waitForResourceState(request, instance.id, "off");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(received.slice(beforeUnsubscribedChange).some((message) =>
      message.type === "sdk:resource-revision" && message.resourceId === "light.study",
    )).toBe(false);

    server.emitEvent("homeassistant_stop", { context: { id: "activity-socket-stop-event" } });
    const activitySnapshot = await waitForMessage((message) =>
      message.type === "activity:snapshot" && message.activities?.some((activity: Record<string, unknown>) => activity.type === "homeassistant.server.stopping"),
    );
    expect(activitySnapshot.activities).toEqual(expect.arrayContaining([
      expect.objectContaining({ source, type: "homeassistant.server.stopping", severity: "warning" }),
    ]));

    socket.close();
  });
});
