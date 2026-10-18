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
let scheduledActive = 0;
let scheduledMaxActive = 0;
let scheduledRuns = 0;
let scheduledStarts = 0;
let releaseScheduledTask: (() => void) | null = null;
let schedulerGate = new Promise<void>((resolve) => { releaseScheduledTask = resolve; });
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

const schedulerDefinition = defineIntegration({
  id: "scheduler-runtime-test",
  name: "Scheduler Runtime Test",
  version: "1.0.0",
  config: {},
  resources: { status: {} },
  start(runtime) {
    runtime.scheduler.every("overlap", 100, async () => {
      scheduledActive += 1;
      scheduledMaxActive = Math.max(scheduledMaxActive, scheduledActive);
      scheduledStarts += 1;
      await schedulerGate;
      scheduledActive -= 1;
      scheduledRuns += 1;
    });
  },
});
registerSdkIntegration(schedulerDefinition);

const invalidSchedulerDefinition = defineIntegration({
  id: "invalid-scheduler-runtime-test",
  name: "Invalid Scheduler Runtime Test",
  version: "1.0.0",
  config: {},
  resources: { status: {} },
  start(runtime) {
    runtime.scheduler.every("too-fast", 1, () => undefined);
  },
});
registerSdkIntegration(invalidSchedulerDefinition);

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
  await stopSdkIntegrationRuntime();
  releaseScheduledTask?.();
  await Promise.resolve();
  exposeSecretAsMetadata = false;
  listenerCalls = 0;
  scheduledActive = 0;
  scheduledMaxActive = 0;
  scheduledRuns = 0;
  scheduledStarts = 0;
  releaseScheduledTask?.();
  releaseScheduledTask = null;
  schedulerGate = new Promise<void>((resolve) => { releaseScheduledTask = resolve; });
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

  test("skips overlapping scheduler ticks and cancels future runs on stop", async () => {
    previousConnector = getDashwiseSDKConnector();
    registerDashwiseSDKConnector(createConnector() as never);
    const instance = await createSdkInstance(owner, { source: schedulerDefinition.id, config: {} });
    await startSdkIntegrationInstance(owner, instance.id);
    const waitFor = async (predicate: () => boolean) => {
      const deadline = Date.now() + 2_000;
      while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
      expect(predicate()).toBe(true);
    };
    await waitFor(() => scheduledStarts >= 1);
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(scheduledMaxActive).toBe(1);
    expect(scheduledStarts).toBe(1);

    releaseScheduledTask?.();
    await waitFor(() => scheduledStarts >= 2);
    await stopSdkIntegrationRuntime();
    releaseScheduledTask = null;
    await new Promise((resolve) => setTimeout(resolve, 180));
    const runsAtStop = scheduledRuns;
    await new Promise((resolve) => setTimeout(resolve, 180));
    expect(scheduledRuns).toBe(runsAtStop);
  });

  test("rejects scheduler intervals below the supported minimum", async () => {
    previousConnector = getDashwiseSDKConnector();
    registerDashwiseSDKConnector(createConnector() as never);
    const instance = await createSdkInstance(owner, { source: invalidSchedulerDefinition.id, config: {} });
    await expect(startSdkIntegrationInstance(owner, instance.id)).rejects.toThrow("between 100ms and 2147483647ms");
  });
});
