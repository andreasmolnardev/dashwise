import { describe, expect, it, mock } from "bun:test";
import type { AreaRegistryEntry, DeviceRegistryEntry, EntityRegistryEntry, HassState } from "../src/ha-types";

type ServerEvent = (event: unknown) => void;

/** A small in-process Home Assistant API/WebSocket fixture used by the real SDK client. */
class MockHomeAssistantServer {
  readonly credentials = { url: "", token: "" };
  readonly serviceCalls: unknown[][] = [];
  readonly listeners = new Map<string, Set<ServerEvent>>();
  readonly subscriptions = new Map<string, Set<ServerEvent>>();
  readonly entityListeners = new Set<(snapshot: Record<string, HassState>) => void>();
  states: HassState[] = [{
    entity_id: "light.study",
    state: "off",
    attributes: { friendly_name: "Study lamp", supported_color_modes: ["brightness"] },
  }];
  entityRegistry: EntityRegistryEntry[] = [{ entity_id: "light.study", unique_id: "study-lamp" }];
  deviceRegistry: DeviceRegistryEntry[] = [{ id: "study-device", name: "Study" }];
  areaRegistry: AreaRegistryEntry[] = [{ area_id: "office", name: "Office" }];
  authenticated = false;
  closed = false;

  readonly connection = {
    addEventListener: (name: string, listener: ServerEvent) => this.addListener(name, listener),
    removeEventListener: (name: string, listener: ServerEvent) => this.removeListener(name, listener),
    sendMessagePromise: async ({ type }: { type: string }) => {
      switch (type) {
        case "config/entity_registry/list": return this.entityRegistry;
        case "config/device_registry/list": return this.deviceRegistry;
        case "config/area_registry/list": return this.areaRegistry;
        default: throw new Error(`Unexpected Home Assistant command: ${type}`);
      }
    },
    subscribeEvents: async (listener: ServerEvent, eventType: string) => {
      const eventListeners = this.subscriptions.get(eventType) ?? new Set<ServerEvent>();
      eventListeners.add(listener);
      this.subscriptions.set(eventType, eventListeners);
      return async () => {
        eventListeners.delete(listener);
        if (!eventListeners.size) this.subscriptions.delete(eventType);
      };
    },
    close: () => { this.closed = true; },
  };

  authenticate(auth: { url: string; accessToken: string }) {
    this.credentials.url = auth.url;
    this.credentials.token = auth.accessToken;
    this.authenticated = auth.accessToken === "valid-long-lived-token";
    if (!this.authenticated) throw new Error("Home Assistant authentication failed");
    return this.connection;
  }

  subscribeEntities(listener: (snapshot: Record<string, HassState>) => void) {
    this.entityListeners.add(listener);
    listener(this.stateMap());
    return () => this.entityListeners.delete(listener);
  }

  replaceStates(states: HassState[]) {
    this.states = states;
    for (const listener of this.entityListeners) listener(this.stateMap());
  }

  emitConnection(state: "ready" | "disconnected" | "reconnect-error") {
    for (const listener of this.listeners.get(state) ?? []) listener(undefined);
  }

  emitEvent(eventType: string, event: unknown) {
    for (const listener of this.subscriptions.get(eventType) ?? []) listener(event);
  }

  private stateMap() {
    return Object.fromEntries(this.states.map((state) => [state.entity_id, state]));
  }

  private addListener(name: string, listener: ServerEvent) {
    const listeners = this.listeners.get(name) ?? new Set<ServerEvent>();
    listeners.add(listener);
    this.listeners.set(name, listeners);
  }

  private removeListener(name: string, listener: ServerEvent) {
    const listeners = this.listeners.get(name);
    listeners?.delete(listener);
    if (!listeners?.size) this.listeners.delete(name);
  }
}

const server = new MockHomeAssistantServer();
mock.module("home-assistant-js-websocket", () => ({
  createLongLivedTokenAuth: (url: string, accessToken: string) => ({ url, accessToken }),
  async createConnection({ auth }: { auth: { url: string; accessToken: string } }) { return server.authenticate(auth); },
  async getStates() { return server.states; },
  subscribeEntities: (_connection: unknown, listener: (snapshot: Record<string, HassState>) => void) => server.subscribeEntities(listener),
  async callService(_connection: unknown, ...args: unknown[]) {
    server.serviceCalls.push(args);
    return { context: { id: "service-context" } };
  },
}));

const { HomeAssistantWebSocketClient, normalizeHomeAssistantUrl } = await import("../src/client");

describe("Home Assistant SDK WebSocket client", () => {
  it("authenticates, synchronizes live entity and registry snapshots, dispatches services, and cleans up", async () => {
    server.closed = false;
    server.authenticated = false;
    server.credentials.url = "";
    server.credentials.token = "";
    server.serviceCalls.length = 0;
    const client = new HomeAssistantWebSocketClient(" https://ha.example/homeassistant/?view=dashboard#home ", "valid-long-lived-token");
    const snapshots: Array<{ states: HassState[]; registries: Record<string, unknown> }> = [];
    const connectionStates: string[] = [];

    const stopListening = client.onConnectionChange((state) => connectionStates.push(state));
    await client.start(async (states, registries) => { snapshots.push({ states, registries }); });

    expect(server.authenticated).toBe(true);
    expect(server.credentials).toEqual({ url: "https://ha.example/homeassistant", token: "valid-long-lived-token" });
    expect(snapshots[0]?.states.map(({ entity_id, state }) => [entity_id, state])).toEqual([["light.study", "off"]]);
    expect(snapshots[0]?.registries).toMatchObject({
      entities: [{ entity_id: "light.study", unique_id: "study-lamp" }],
      devices: [{ id: "study-device" }],
      areas: [{ area_id: "office" }],
    });

    server.replaceStates([{
      entity_id: "light.reading_lamp",
      state: "on",
      attributes: { friendly_name: "Reading lamp", supported_color_modes: ["brightness"] },
    }]);
    expect(snapshots.at(-1)?.states.map(({ entity_id, attributes }) => [entity_id, attributes.friendly_name])).toEqual([[
      "light.reading_lamp",
      "Reading lamp",
    ]]);

    await client.callService("light", "turn_on", { brightness: 127 }, { entity_id: "light.reading_lamp" });
    expect(server.serviceCalls).toEqual([["light", "turn_on", { brightness: 127 }, { entity_id: "light.reading_lamp" }]]);

    let started: unknown;
    await client.subscribeEvent("homeassistant_start", (event) => { started = event; });
    const startEvent = { context: { id: "restart-event" } };
    server.emitEvent("homeassistant_start", startEvent);
    expect(started).toEqual(startEvent);

    server.emitConnection("disconnected");
    server.emitConnection("ready");
    expect(connectionStates).toEqual(["disconnected", "ready"]);

    stopListening();
    await client.stop();
    expect(server.closed).toBe(true);
    expect(server.subscriptions.has("homeassistant_start")).toBe(false);
  });

  it("rejects invalid protocol, embedded credentials, and missing access tokens", async () => {
    expect(() => normalizeHomeAssistantUrl("ws://ha.example")).toThrow("http or https");
    expect(() => normalizeHomeAssistantUrl("https://user:secret@ha.example")).toThrow("Credentials");
    const client = new HomeAssistantWebSocketClient("https://ha.example", "  ");
    await expect(client.start(async () => {})).rejects.toThrow("access token is required");
  });
});
