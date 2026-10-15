import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { PlaybackListenerContext } from "@dashwise/integrations-sdk";
import { createMediaRoute } from "./media.route";

function fixture() {
  const events: number[] = [];
  let disposed = 0;
  let forwardedRange = "";
  const sourceContext = (identity: { userId: string; integrationInstanceId: string; sessionId: string; collectionId: string; resourceId: string }) => ({
    ...identity,
    resource: { id: identity.resourceId, name: "Track", playback: true },
    source: { url: "https://media.example/audio.mp3?token=private", auth: { headers: { Authorization: "Bearer private" } }, kind: "audio" as const, metadata: { title: "Track", durationSeconds: 6 } },
  });
  const route = createMediaRoute({
    authenticate: async (token) => token === "user-a" || token === "user-b" ? token : Promise.reject(new Error("unauthorized")),
    resolve: async (identity) => ({
      resource: { id: identity.resourceId, name: "Track", playback: true },
      source: sourceContext(identity).source,
      listenerContext: sourceContext(identity) as PlaybackListenerContext,
    }),
    dispatch: async (_context, event) => { events.push(event.sequence); if (event.type === "ended") throw new Error("provider listener failed"); },
    dispose: async () => { disposed++; },
    fetchSource: async (_context, request) => {
      forwardedRange = request.headers.get("range") ?? "";
      return new Response("stream", { status: 206, headers: { "content-range": "bytes 0-5/6", "content-type": "audio/mpeg" } });
    },
  });
  const app = new Hono();
  app.route("/", route);
  const request = (path: string, token = "user-a", body?: unknown, method = "POST", headers?: Record<string, string>) => app.request(path, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { request, events, get disposed() { return disposed; }, get forwardedRange() { return forwardedRange; } };
}

describe("media playback sessions", () => {
  test("keeps upstream auth private and proxies range requests through the scoped capability", async () => {
    const fx = fixture();
    const created = await fx.request("/api/v1/media/sessions", "user-a", { resource: { integrationInstanceId: "i", collectionId: "tracks/music", resourceId: "provider/track-1" } });
    expect(created.status).toBe(200);
    const result = await created.json() as { id: string; source: { url: string } };
    expect(result.source.url).not.toContain("private");
    const stream = await fx.request(result.source.url, "user-a", undefined, "GET", { range: "bytes=0-5" });
    expect(stream.status).toBe(206);
    expect(stream.headers.get("content-range")).toBe("bytes 0-5/6");
    expect(fx.forwardedRange).toBe("bytes=0-5");
    expect(await stream.text()).toBe("stream");
  });

  test("binds sessions to their owner, deduplicates sequences, and disposes once on terminal event", async () => {
    const fx = fixture();
    const created = await fx.request("/api/v1/media/sessions", "user-a", { resource: { integrationInstanceId: "i", collectionId: "tracks", resourceId: "a/b" } });
    const { id } = await created.json() as { id: string };
    const body = { sequence: 3, type: "started" };
    expect((await fx.request(`/api/v1/media/sessions/${id}/events`, "user-b", body)).status).toBe(404);
    expect(await (await fx.request(`/api/v1/media/sessions/${id}/events`, "user-a", body)).json()).toEqual({ accepted: true });
    expect(await (await fx.request(`/api/v1/media/sessions/${id}/events`, "user-a", body)).json()).toEqual({ accepted: false });
    expect(fx.events).toEqual([3]);
    expect(await (await fx.request(`/api/v1/media/sessions/${id}/events`, "user-a", { sequence: 4, type: "ended" })).json()).toEqual({ accepted: true });
    expect(fx.disposed).toBe(1);
    expect((await fx.request(`/api/v1/media/sessions/${id}`, "user-a", undefined, "DELETE")).status).toBe(200);
    expect(fx.disposed).toBe(1);
  });

  test("disposes expired sessions after queued work has completed", async () => {
    let now = 10_000;
    let disposed = 0;
    let releaseListener!: () => void;
    let listenerStarted!: () => void;
    const listenerGate = new Promise<void>((resolve) => { releaseListener = resolve; });
    const started = new Promise<void>((resolve) => { listenerStarted = resolve; });
    const route = createMediaRoute({
      clock: () => now,
      sessionTtlMs: 5,
      startCleanupTimer: false,
      authenticate: async () => "user-a",
      resolve: async (identity) => {
        const context: PlaybackListenerContext = {
          ...identity,
          resource: { id: identity.resourceId, name: "Track", playback: true },
          source: { url: "https://media.example/audio.mp3" },
        };
        return { source: context.source, resource: context.resource, listenerContext: context };
      },
      dispatch: async () => { listenerStarted(); await listenerGate; },
      dispose: async () => { disposed++; },
      fetchSource: async () => new Response("unused"),
    });
    const app = new Hono();
    app.route("/", route);
    const create = await app.request("/api/v1/media/sessions", {
      method: "POST", headers: { authorization: "Bearer user-a", "content-type": "application/json" },
      body: JSON.stringify({ resource: { integrationInstanceId: "i", collectionId: "tracks", resourceId: "a" } }),
    });
    const { id } = await create.json() as { id: string };
    const eventPromise = app.request(`/api/v1/media/sessions/${id}/events`, {
      method: "POST", headers: { authorization: "Bearer user-a", "content-type": "application/json" },
      body: JSON.stringify({ sequence: 1, type: "progress", positionSeconds: 2 }),
    });
    await started;
    now += 10;
    const expired = await app.request(`/api/v1/media/sessions/${id}/events`, {
      method: "POST", headers: { authorization: "Bearer user-a", "content-type": "application/json" },
      body: JSON.stringify({ sequence: 2, type: "progress", positionSeconds: 3 }),
    });
    expect(expired.status).toBe(410);
    expect(disposed).toBe(0);
    releaseListener();
    await eventPromise;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(disposed).toBe(1);
  });

  test("DELETE waits for an in-flight listener before disposal", async () => {
    let disposed = 0;
    let releaseListener!: () => void;
    let listenerStarted!: () => void;
    const gate = new Promise<void>((resolve) => { releaseListener = resolve; });
    const started = new Promise<void>((resolve) => { listenerStarted = resolve; });
    const route = createMediaRoute({
      startCleanupTimer: false,
      authenticate: async () => "user-a",
      resolve: async (identity) => {
        const context: PlaybackListenerContext = {
          ...identity,
          resource: { id: identity.resourceId, name: "Track", playback: true },
          source: { url: "https://media.example/audio.mp3" },
        };
        return { source: context.source, resource: context.resource, listenerContext: context };
      },
      dispatch: async () => { listenerStarted(); await gate; },
      dispose: async () => { disposed++; },
      fetchSource: async () => new Response("unused"),
    });
    const app = new Hono();
    app.route("/", route);
    const created = await app.request("/api/v1/media/sessions", {
      method: "POST", headers: { authorization: "Bearer user-a", "content-type": "application/json" },
      body: JSON.stringify({ resource: { integrationInstanceId: "i", collectionId: "tracks", resourceId: "a" } }),
    });
    const { id } = await created.json() as { id: string };
    const event = app.request(`/api/v1/media/sessions/${id}/events`, {
      method: "POST", headers: { authorization: "Bearer user-a", "content-type": "application/json" },
      body: JSON.stringify({ sequence: 1, type: "started" }),
    });
    await started;
    const deletion = app.request(`/api/v1/media/sessions/${id}`, { method: "DELETE", headers: { authorization: "Bearer user-a" } });
    await Promise.resolve();
    expect(disposed).toBe(0);
    releaseListener();
    await event;
    expect((await deletion).status).toBe(200);
    expect(disposed).toBe(1);
  });
});
