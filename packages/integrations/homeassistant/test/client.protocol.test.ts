import { describe, expect, it } from "bun:test";
import { HomeAssistantWebSocketClient } from "../src/client";
import type { HassRegistrySnapshot, HassState } from "../src/ha-types";
import { MockHomeAssistantServer } from "./mock-homeassistant-server";

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for the Home Assistant WebSocket fixture");
}

describe("Home Assistant SDK against the protocol-level mock server", () => {
  it("authenticates, reads registries, dispatches services, reconciles entities, and recovers after a server restart", async () => {
    const server = new MockHomeAssistantServer();
    await server.start();
    const client = new HomeAssistantWebSocketClient(server.url, server.validToken, 5_000);
    const snapshots: Array<{ states: HassState[]; registries: HassRegistrySnapshot }> = [];
    const connectionStates: string[] = [];
    const events: unknown[] = [];
    const stopListening = client.onConnectionChange((state) => connectionStates.push(state));

    try {
      await client.start(async (states, registries) => { snapshots.push({ states, registries }); });

      expect(snapshots[0]?.states.map(({ entity_id, state }) => [entity_id, state])).toEqual([[
        "light.study",
        "off",
      ]]);
      const registries = await client.refreshRegistries();
      expect(registries).toMatchObject({
        entities: [{ entity_id: "light.study", unique_id: "study-lamp" }],
        devices: [{ id: "study-device" }],
        areas: [{ area_id: "office" }],
      });

      await client.callService("light", "turn_on", { brightness: 127 }, { entity_id: "light.study" });
      expect(server.serviceCalls).toHaveLength(1);
      expect(server.serviceCalls[0]).toMatchObject({
        type: "call_service",
        domain: "light",
        service: "turn_on",
        service_data: { brightness: 127 },
        target: { entity_id: "light.study" },
      });

      await client.subscribeEvent("homeassistant_start", (event) => { events.push(event); });
      server.emitEvent("homeassistant_start", { context: { id: "mock-start-event" } });
      await waitFor(() => events.length === 1);
      expect(events[0]).toEqual({ context: { id: "mock-start-event" } });

      server.replaceStates([{
        entity_id: "light.study_lamp",
        state: "on",
        attributes: { friendly_name: "Reading lamp", supported_color_modes: ["brightness"] },
      }], [{ entity_id: "light.study_lamp", unique_id: "study-lamp", name: "Reading lamp" }]);
      await client.refreshDiscovery();
      await waitFor(() => snapshots.at(-1)?.states.some(({ entity_id }) => entity_id === "light.study_lamp") === true);
      expect(snapshots.at(-1)?.states.map(({ entity_id, state }) => [entity_id, state])).toEqual([[
        "light.study_lamp",
        "on",
      ]]);
      expect(snapshots.at(-1)?.registries.entities).toEqual([{
        entity_id: "light.study_lamp",
        unique_id: "study-lamp",
        name: "Reading lamp",
      }]);

      const snapshotsBeforeRestart = snapshots.length;
      await server.restart();
      await waitFor(() => connectionStates.includes("disconnected"));
      await waitFor(() => connectionStates.includes("ready"));
      await waitFor(() => snapshots.length > snapshotsBeforeRestart);
      expect(snapshots.at(-1)?.states.map(({ entity_id, state }) => [entity_id, state])).toEqual([[
        "light.study_lamp",
        "on",
      ]]);
    } finally {
      stopListening();
      await client.stop();
      await server.stop();
    }
  });

  it("rejects invalid credentials through the Home Assistant auth handshake", async () => {
    const server = new MockHomeAssistantServer();
    await server.start();
    const client = new HomeAssistantWebSocketClient(server.url, "invalid-token", 5_000);
    try {
      await expect(client.start(async () => {})).rejects.toThrow();
    } finally {
      await client.stop();
      await server.stop();
    }
  });
});
