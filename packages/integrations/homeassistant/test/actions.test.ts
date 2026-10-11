import { describe, expect, it } from "bun:test";
import type { HomeAssistantWebSocketClient } from "../src/client";
import { actions, attachClient, stopClient } from "../src/actions";
import type { ResourceRecord } from "@dashwise/integrations-sdk";

describe("Home Assistant Actions", () => {
  it("targets the canonical resource ID and reports only command acceptance", async () => {
    const calls: unknown[][] = [];
    const runtime = {};
    const client = {
      callService: async (...args: unknown[]) => { calls.push(args); return { success: true }; },
      stop: async () => {},
    } as unknown as HomeAssistantWebSocketClient;
    attachClient(runtime, client);
    const resource: ResourceRecord = { id: "light.office", name: "Office", type: "light" };

    const result = await actions.toggle.execute(runtime, resource);

    expect(calls).toEqual([["light", "toggle", undefined, { entity_id: "light.office" }]]);
    expect(result).toEqual({ accepted: true, entityId: "light.office", service: "light.toggle" });
    await stopClient(runtime);
  });

  it("validates brightness and sends the supported Home Assistant payload", async () => {
    const calls: unknown[][] = [];
    const runtime = {};
    attachClient(runtime, {
      callService: async (...args: unknown[]) => { calls.push(args); },
      stop: async () => {},
    } as unknown as HomeAssistantWebSocketClient);
    const resource: ResourceRecord = { id: "light.desk", name: "Desk", type: "light" };

    await expect(actions.setBrightness.execute(runtime, resource, { brightness: 256 })).rejects.toThrow("between 0 and 255");
    await actions.setBrightness.execute(runtime, resource, { brightness: 128 });
    expect(calls).toEqual([["light", "turn_on", { brightness: 128 }, { entity_id: "light.desk" }]]);
    await stopClient(runtime);
  });
});
