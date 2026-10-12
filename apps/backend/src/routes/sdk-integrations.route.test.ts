import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { getDashwiseSDKConnector, registerDashwiseSDKConnector } from "../lib/pb/pocketbase";
import { hashSessionToken } from "../lib/data/sessions";
import { registerSdkIntegration } from "../lib/integrations-sdk/catalog";
import { startSdkIntegrationRuntime, stopSdkIntegrationRuntime } from "../lib/integrations-sdk/runtime";
import sdkIntegrationsRoute from "./sdk-integrations.route";

const userId = "sdk-test-user";
const token = "dws_sdk-integration-test-token";
const source = "homeassistant";
const haServiceCalls: unknown[][] = [];
const haEventListeners = new Map<string, (event: unknown) => unknown>();
let haConnectionClosed = false;
let haConnectionAttempts = 0;
let haConnectionFailure = false;
let haConnectionStartGate: Promise<void> | null = null;
const hassState = {
  entity_id: "light.kitchen",
  state: "off",
  attributes: { friendly_name: "Kitchen lamp", brightness: 128, supported_color_modes: ["brightness"] },
  last_updated: "2026-10-12T00:00:00.000Z",
};
const connection = {
  addEventListener() {},
  removeEventListener() {},
  async sendMessagePromise({ type }: { type: string }) {
    if (type === "config/entity_registry/list") return [{ entity_id: hassState.entity_id, unique_id: "fixture-kitchen-light" }];
    return [];
  },
  async subscribeEvents(listener: (event: unknown) => unknown, eventType: string) {
    haEventListeners.set(eventType, listener);
    return async () => { haEventListeners.delete(eventType); };
  },
  close() { haConnectionClosed = true; },
};

mock.module("home-assistant-js-websocket", () => ({
  createLongLivedTokenAuth: (url: string, accessToken: string) => ({ url, accessToken }),
  async createConnection() {
    haConnectionAttempts += 1;
    haConnectionClosed = false;
    if (haConnectionFailure) throw new Error("Home Assistant is unreachable");
    if (haConnectionStartGate) await haConnectionStartGate;
    return connection;
  },
  async getStates() { return [hassState]; },
  subscribeEntities(_connection: unknown, listener: (snapshot: Record<string, typeof hassState>) => void) {
    listener({ [hassState.entity_id]: hassState });
    return () => {};
  },
  async callService(_connection: unknown, domain: string, service: string, data: unknown, target: unknown) {
    haServiceCalls.push([domain, service, data, target]);
    return { context: { id: "fixture-service-call" } };
  },
}));

const { homeAssistant } = await import("../../../../packages/integrations/homeassistant/src/index");

type Row = Record<string, any> & { id: string };

function matches(row: Row, filter = "") {
  return filter.split(/\s+&&\s+/).every((clause) => {
    const match = /^([\w]+)\s*(=|>=|<=|>|<)\s*(?:"((?:\\.|[^"])*)"|(true|false))$/.exec(clause.trim());
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
    id: "session-record", user: userId, sessionId: "session-device", tokenHash: hashSessionToken(token),
    pocketbaseToken: "internal-pb-token", expiresAt: new Date(Date.now() + 60_000).toISOString(),
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

let previousConnector: ReturnType<typeof getDashwiseSDKConnector>;
let fixture: ReturnType<typeof createPocketBaseFixture>;

beforeEach(() => {
  previousConnector = getDashwiseSDKConnector();
  fixture = createPocketBaseFixture();
  haServiceCalls.length = 0;
  haEventListeners.clear();
  haConnectionClosed = false;
  haConnectionAttempts = 0;
  haConnectionFailure = false;
  haConnectionStartGate = null;
  registerDashwiseSDKConnector(fixture.connector as never);
});
afterEach(async () => {
  await stopSdkIntegrationRuntime();
  registerDashwiseSDKConnector(previousConnector);
});

registerSdkIntegration(homeAssistant);

describe("SDK integration API with an in-memory PocketBase connector", () => {
  test("serializes stop requests behind an in-progress instance startup", async () => {
    let allowConnection!: () => void;
    haConnectionStartGate = new Promise<void>((resolve) => { allowConnection = resolve; });
    const request = (path: string, init: RequestInit = {}) => sdkIntegrationsRoute.fetch(new Request(`http://localhost${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    }));
    const createPromise = request("/api/v1/sdk-integrations/instances", {
      method: "POST",
      body: JSON.stringify({ source, name: "Local Home Service", config: { url: "http://192.168.1.50:8123", accessToken: "fixture-secret-token" } }),
    });

    for (let attempt = 0; attempt < 100 && haConnectionAttempts === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    expect(haConnectionAttempts).toBe(1);

    const stopPromise = stopSdkIntegrationRuntime();
    const earlyStop = await Promise.race([
      stopPromise.then(() => "stopped"),
      new Promise<string>((resolve) => setTimeout(() => resolve("startup-pending"), 10)),
    ]);
    expect(earlyStop).toBe("startup-pending");

    allowConnection();
    expect((await createPromise).status).toBe(200);
    await stopPromise;
    expect(haConnectionClosed).toBe(true);
  });

  test("restores a configured Home Assistant instance after runtime restart and syncs resources, actions, and Activities", async () => {
    const request = (path: string, init: RequestInit = {}) => sdkIntegrationsRoute.fetch(new Request(`http://localhost${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    }));
    const createResponse = await request("/api/v1/sdk-integrations/instances", {
      method: "POST",
      body: JSON.stringify({ source, name: "Local Home Service", config: { url: "http://192.168.1.50:8123", accessToken: "fixture-secret-token" } }),
    });
    expect(createResponse.status).toBe(200);
    const created = await createResponse.json() as { instance: { id: string; config: Record<string, unknown>; configuredSecrets: string[] } };
    const instanceId = created.instance.id;
    expect(created.instance.config).toEqual({ url: "http://192.168.1.50:8123" });
    expect(created.instance.configuredSecrets).toEqual(["accessToken"]);
    expect(haEventListeners.has("homeassistant_stop")).toBe(true);

    const statusResponse = await request(`/api/v1/sdk-integrations/instances/${instanceId}/status`);
    expect(statusResponse.status).toBe(200);
    expect(await statusResponse.json()).toMatchObject({ status: { state: "ready" } });

    haConnectionFailure = true;
    const failedTestResponse = await request(`/api/v1/sdk-integrations/instances/${instanceId}/test-connection`, { method: "POST", body: "{}" });
    expect(failedTestResponse.status).toBe(200);
    expect(await failedTestResponse.json()).toMatchObject({
      success: false,
      status: { state: "error", message: "Home Assistant is unreachable" },
    });
    haConnectionFailure = false;
    const successfulTestResponse = await request(`/api/v1/sdk-integrations/instances/${instanceId}/test-connection`, { method: "POST", body: "{}" });
    expect(successfulTestResponse.status).toBe(200);
    expect(await successfulTestResponse.json()).toMatchObject({ success: true, status: { state: "ready" } });

    const resourceResponse = await request(`/api/v1/sdk-integrations/instances/${instanceId}/resources?collectionId=entities`);
    expect(resourceResponse.status).toBe(200);
    expect(await resourceResponse.json()).toMatchObject({ resources: [{
      id: "light.kitchen", name: "Kitchen lamp", state: "off", collectionId: "entities", stale: false,
    }] });

    await stopSdkIntegrationRuntime();
    expect(haConnectionClosed).toBe(true);
    await startSdkIntegrationRuntime();
    expect(haConnectionAttempts).toBe(4);
    expect(haEventListeners.has("homeassistant_stop")).toBe(true);
    const restoredResourceResponse = await request(`/api/v1/sdk-integrations/instances/${instanceId}/resources?collectionId=entities`);
    expect(restoredResourceResponse.status).toBe(200);
    expect(await restoredResourceResponse.json()).toMatchObject({ resources: [{
      id: "light.kitchen", name: "Kitchen lamp", state: "off", collectionId: "entities", stale: false,
    }] });

    const actionResponse = await request(`/api/v1/sdk-integrations/instances/${instanceId}/actions/turnOn`, {
      method: "POST", body: JSON.stringify({ collectionId: "entities", resourceId: "light.kitchen" }),
    });
    expect(actionResponse.status).toBe(200);
    expect(await actionResponse.json()).toEqual({ result: { accepted: true, entityId: "light.kitchen", service: "light.turn_on" } });
    expect(haServiceCalls).toEqual([["light", "turn_on", undefined, { entity_id: "light.kitchen" }]]);
    const onStop = haEventListeners.get("homeassistant_stop");
    expect(onStop).toBeDefined();
    await onStop!({ context: { id: "ha-stop-event-1" } });
    expect(fixture.tables.get("activities")).toHaveLength(1);
    expect(fixture.tables.get("activities")?.[0]).toMatchObject({
      owner: userId, source, sourceId: instanceId, type: "homeassistant.server.stopping", title: "Home Assistant is restarting or shutting down", severity: "warning",
    });

    const deleteResponse = await request(`/api/v1/sdk-integrations/instances/${instanceId}`, { method: "DELETE" });
    expect(deleteResponse.status).toBe(200);
    expect(haConnectionClosed).toBe(true);
  });
});
