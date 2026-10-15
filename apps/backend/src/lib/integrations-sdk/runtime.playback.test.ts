import { afterEach, describe, expect, test } from "bun:test";
import { defineIntegration } from "@dashwise/integrations-sdk";
import { registerDashwiseSDKConnector, getDashwiseSDKConnector } from "../pb/pocketbase";
import { createSdkInstance } from "./persistence";
import { registerSdkIntegration } from "./catalog";
import { dispatchSdkPlaybackEvent, resolveSdkPlayback, startSdkIntegrationInstance, stopSdkIntegrationRuntime } from "./runtime";

const owner = "playback-runtime-test-user";
const privateToken = "provider-private-playback-token";
let listenerCalls = 0;
let exposeSecretAsMetadata = false;
const playbackDefinition = defineIntegration({
  id: "playback-runtime-test",
  name: "Playback Runtime Test",
  version: "1.0.0",
  config: {
    baseUrl: { type: "url", required: true },
    token: { type: "secret", required: true },
  },
  resources: { tracks: {} },
  async start(runtime) {
    await runtime.resources.tracks.upsert({ id: "provider/track-1", name: "Track", playback: true });
  },
  playback: {
    async resolve(runtime, _resource, identity) {
      const token = await runtime.secrets.get("token");
      return {
        source: {
          url: `${runtime.config.baseUrl}/media/stream?token=${token}`,
          auth: { headers: { Authorization: `Bearer ${token}` } },
          metadata: { title: exposeSecretAsMetadata ? token! : "Track", durationSeconds: 120 },
          kind: "audio",
        },
        context: { upstreamId: `upstream-${identity.sessionId}` },
      };
    },
    listeners: {
      started() { listenerCalls++; },
    },
  },
});

registerSdkIntegration(playbackDefinition);

function createConnector() {
  const tables = new Map<string, Array<Record<string, any>>>();
  let nextId = 0;
  const collection = (name: string) => {
    const rows = tables.get(name) ?? [];
    tables.set(name, rows);
    return {
      async create(data: Record<string, any>) {
        const row = { ...data, id: data.id ?? `${name}-${++nextId}`, created: new Date().toISOString() };
        rows.push(row);
        return row;
      },
      async getOne(id: string) {
        const row = rows.find((candidate) => candidate.id === id);
        if (!row) throw new Error("Record not found");
        return row;
      },
      async getFirstListItem() { throw new Error("Record not found"); },
      async getFullList() { return [...rows]; },
      async update(id: string, changes: Record<string, any>) {
        const row = rows.find((candidate) => candidate.id === id);
        if (!row) throw new Error("Record not found");
        Object.assign(row, changes);
        return row;
      },
      async delete(id: string) {
        const index = rows.findIndex((candidate) => candidate.id === id);
        if (index >= 0) rows.splice(index, 1);
      },
    };
  };
  return { getSuperuserClient: async () => ({ collection }), createServerClient: () => ({}) };
}

let previousConnector = getDashwiseSDKConnector();
afterEach(async () => {
  exposeSecretAsMetadata = false;
  listenerCalls = 0;
  await stopSdkIntegrationRuntime();
  registerDashwiseSDKConnector(previousConnector);
  previousConnector = getDashwiseSDKConnector();
});

describe("SDK playback runtime", () => {
  test("keeps protected source auth server-side, accepts numeric duration, and invalidates old contexts on restart", async () => {
    previousConnector = getDashwiseSDKConnector();
    registerDashwiseSDKConnector(createConnector() as never);
    const instance = await createSdkInstance(owner, {
      source: playbackDefinition.id,
      config: { baseUrl: "http://192.168.1.50:8123", token: privateToken },
    });
    await startSdkIntegrationInstance(owner, instance.id);
    const resolved = await resolveSdkPlayback({
      userId: owner,
      integrationInstanceId: instance.id,
      sessionId: "playback-session-one",
      collectionId: "tracks",
      resourceId: "provider/track-1",
    });
    expect(resolved.source.metadata?.durationSeconds).toBe(120);
    expect(resolved.source.auth?.headers.Authorization).toContain(privateToken);
    expect(resolved.listenerContext.context).toEqual({ upstreamId: "upstream-playback-session-one" });
    await dispatchSdkPlaybackEvent(resolved.listenerContext, { sequence: 1, type: "started" });
    expect(listenerCalls).toBe(1);

    await stopSdkIntegrationRuntime();
    await startSdkIntegrationInstance(owner, instance.id);
    await dispatchSdkPlaybackEvent(resolved.listenerContext, { sequence: 2, type: "progress", positionSeconds: 3 });
    expect(listenerCalls).toBe(1);
  });

  test("rejects configured secrets copied into public playback metadata", async () => {
    previousConnector = getDashwiseSDKConnector();
    registerDashwiseSDKConnector(createConnector() as never);
    const instance = await createSdkInstance(owner, {
      source: playbackDefinition.id,
      config: { baseUrl: "http://192.168.1.50:8123", token: privateToken },
    });
    await startSdkIntegrationInstance(owner, instance.id);
    exposeSecretAsMetadata = true;
    await expect(resolveSdkPlayback({
      userId: owner,
      integrationInstanceId: instance.id,
      sessionId: "playback-session-two",
      collectionId: "tracks",
      resourceId: "provider/track-1",
    })).rejects.toThrow("unsafe playback source");
  });
});
