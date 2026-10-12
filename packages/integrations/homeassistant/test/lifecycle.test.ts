import { describe, expect, it } from "bun:test";
import type { ResourceRecord } from "@dashwise/integrations-sdk";
import { createHomeAssistantIntegration } from "../src";
import type { HassState, HassRegistrySnapshot, HomeAssistantClient } from "../src/ha-types";

class MockHomeAssistantClient implements HomeAssistantClient {
  readonly serviceCalls: unknown[][] = [];
  readonly eventHandlers = new Map<string, Array<(event: unknown) => void | Promise<void>>>();
  private readonly connectionListeners = new Set<(state: "ready" | "disconnected" | "error") => void>();
  private snapshotHandler?: (states: HassState[], registries: HassRegistrySnapshot) => Promise<void>;

  async start(onSnapshot: (states: HassState[], registries: HassRegistrySnapshot) => Promise<void>): Promise<void> {
    this.snapshotHandler = onSnapshot;
    for (const listener of this.connectionListeners) listener("ready");
    await onSnapshot([
      {
        entity_id: "light.study",
        state: "on",
        attributes: { friendly_name: "Study light", supported_color_modes: ["brightness"] },
      },
      { entity_id: "sensor.office_temperature", state: "22", attributes: { friendly_name: "Office temperature" } },
    ], { entities: [], devices: [], areas: [] });
  }

  async refreshDiscovery(): Promise<void> {
    await this.snapshotHandler?.([
      {
        entity_id: "light.study",
        state: "on",
        attributes: { friendly_name: "Study light", supported_color_modes: ["brightness"] },
      },
      { entity_id: "sensor.office_temperature", state: "22", attributes: { friendly_name: "Office temperature" } },
    ], { entities: [], devices: [], areas: [] });
  }
  async stop(): Promise<void> { this.snapshotHandler = undefined; }

  async emitSnapshot(states: HassState[], registries: HassRegistrySnapshot = { entities: [], devices: [], areas: [] }) {
    await this.snapshotHandler?.(states, registries);
  }

  emitConnectionState(state: "ready" | "disconnected" | "error") {
    for (const listener of this.connectionListeners) listener(state);
  }

  async callService(
    domain: string,
    service: string,
    serviceData?: Record<string, unknown>,
    target?: Record<string, unknown>,
  ): Promise<unknown> {
    this.serviceCalls.push([domain, service, serviceData, target]);
    return { success: true };
  }

  async refreshRegistries(): Promise<HassRegistrySnapshot> {
    return { entities: [], devices: [], areas: [] };
  }

  onConnectionChange(listener: (state: "ready" | "disconnected" | "error") => void): () => void {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }

  async subscribeEvent(eventType: string, listener: (event: unknown) => void): Promise<() => Promise<void>> {
    const listeners = this.eventHandlers.get(eventType) ?? [];
    listeners.push(listener);
    this.eventHandlers.set(eventType, listeners);
    return async () => {
      this.eventHandlers.set(eventType, (this.eventHandlers.get(eventType) ?? []).filter((item) => item !== listener));
    };
  }

  async emitEvent(eventType: string, event: unknown): Promise<void> {
    await Promise.all((this.eventHandlers.get(eventType) ?? []).map((listener) => listener(event)));
  }
}

function makeRuntime() {
  const synced: Record<string, ResourceRecord[]> = { entities: [], status: [] };
  const syncOptions: Record<string, unknown> = {};
  const activities: Array<Record<string, unknown>> = [];
  const secretReads: string[] = [];
  const scheduled = new Map<string, (signal: AbortSignal) => void | Promise<void>>();
  const runtime = {
    instanceId: "ha-test-instance",
    config: { url: "http://homeassistant.local:8123" },
    secrets: {
      async get(key: string) {
        secretReads.push(key);
        return key === "accessToken" ? "test-long-lived-token" : undefined;
      },
    },
    resources: {
      entities: {
        async sync(records: readonly ResourceRecord[], options: unknown) {
          synced.entities = [...records];
          syncOptions.entities = options;
        },
      },
      status: {
        async sync(records: readonly ResourceRecord[], options: unknown) {
          synced.status = [...records];
          syncOptions.status = options;
        },
      },
    },
    http: { async assertSafeUrl(input: string | URL) { return new URL(input); } },
    activities: {
      async publish(activity: Record<string, unknown>) {
        activities.push(activity);
        return { id: `activity-${activities.length}`, duplicate: false };
      },
    },
    scheduler: {
      timeout(name: string, _delayMs: number, task: (signal: AbortSignal) => void | Promise<void>) { scheduled.set(name, task); },
      cancel(name: string) { scheduled.delete(name); },
      every() {},
    },
    logger: { info() {}, warn() {}, error() {} },
    onDispose() {},
  };
  return { runtime, synced, syncOptions, activities, secretReads, scheduled };
}

function flushAsyncUpdates() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("Home Assistant SDK lifecycle", () => {
  it("runs setup and start, then synchronizes entity and status resources from discovery", async () => {
    const client = new MockHomeAssistantClient();
    const factoryArgs: string[][] = [];
    const integration = createHomeAssistantIntegration((url, token) => {
      factoryArgs.push([url, token]);
      return client;
    });
    const { runtime, synced, syncOptions, secretReads } = makeRuntime();
    type Runtime = Parameters<NonNullable<typeof integration.setup>>[0];
    const sdkRuntime = runtime as unknown as Runtime;

    await integration.setup?.(sdkRuntime);
    await integration.start?.(sdkRuntime);

    expect(secretReads).toEqual(["accessToken", "accessToken"]);
    expect(factoryArgs).toEqual([["http://homeassistant.local:8123/", "test-long-lived-token"]]);
    expect(synced.entities.map(({ id, state }) => [id, state])).toEqual([
      ["light.study", "on"],
      ["sensor.office_temperature", "22"],
    ]);
    expect(synced.status.find(({ id }) => id === "lights-on")?.state).toBe(1);
    expect(syncOptions.entities).toEqual({ completeness: "complete" });
    expect(syncOptions.status).toEqual({ completeness: "complete" });

    await integration.stop?.(sdkRuntime);
    await integration.dispose?.(sdkRuntime);
  });

  it("dispatches an entity action and publishes Activities for HA lifecycle events", async () => {
    const client = new MockHomeAssistantClient();
    const integration = createHomeAssistantIntegration(() => client);
    const { runtime, synced, activities } = makeRuntime();
    type Runtime = Parameters<NonNullable<typeof integration.start>>[0];
    const sdkRuntime = runtime as unknown as Runtime;

    await integration.start?.(sdkRuntime);
    const light = synced.entities.find(({ id }) => id === "light.study");
    if (!light) throw new Error("Expected the discovered Home Assistant light");
    const action = integration.actions?.toggle;
    if (!action) throw new Error("Expected the Home Assistant toggle action");
    const result = await action.execute(sdkRuntime, light, undefined);

    expect(client.serviceCalls).toEqual([
      ["light", "toggle", undefined, { entity_id: "light.study" }],
    ]);
    expect(result).toEqual({ accepted: true, entityId: "light.study", service: "light.toggle" });

    await client.emitEvent("homeassistant_stop", { context: { id: "ha-stop-context" } });
    await client.emitEvent("homeassistant_start", { context: { id: "ha-start-context" } });
    expect(activities.map(({ type, idempotencyKey }) => [type, idempotencyKey])).toEqual([
      ["homeassistant.server.stopping", "ha-stop-context"],
      ["homeassistant.server.started", "ha-start-context"],
    ]);

    await integration.stop?.(sdkRuntime);
    await integration.dispose?.(sdkRuntime);
  });

  it("reconciles renamed and removed entities and publishes debounced connection recovery", async () => {
    const client = new MockHomeAssistantClient();
    const integration = createHomeAssistantIntegration(() => client);
    const { runtime, synced, syncOptions, activities, scheduled } = makeRuntime();
    type Runtime = Parameters<NonNullable<typeof integration.start>>[0];
    const sdkRuntime = runtime as unknown as Runtime;

    await integration.start?.(sdkRuntime);
    await client.emitSnapshot([
      {
        entity_id: "light.study_lamp",
        state: "off",
        attributes: { friendly_name: "Reading lamp", supported_color_modes: ["brightness"] },
      },
    ]);

    expect(synced.entities.map(({ id }) => id)).toEqual(["light.study_lamp"]);
    expect(synced.entities[0]?.name).toBe("Reading lamp");
    expect(syncOptions.entities).toEqual({ completeness: "complete" });

    client.emitConnectionState("disconnected");
    await flushAsyncUpdates();
    expect(synced.status.find(({ id }) => id === "connection")?.state).toBe("disconnected");
    const lossActivity = scheduled.get("connection-lost-activity");
    expect(lossActivity).toBeDefined();
    await lossActivity?.(new AbortController().signal);
    await flushAsyncUpdates();
    expect(activities.map(({ type }) => type)).toContain("homeassistant.connection.lost");

    client.emitConnectionState("ready");
    await flushAsyncUpdates();
    expect(synced.status.find(({ id }) => id === "connection")?.state).toBe("connected");
    expect(activities.map(({ type }) => type)).toContain("homeassistant.connection.recovered");

    await integration.stop?.(sdkRuntime);
    await integration.dispose?.(sdkRuntime);
  });
});
