import { describe, expect, test } from "bun:test";
import { mapGroovewiseItem, mapGroovewiseItems } from "../src/mapping";
import groovewise from "../src/index";

describe("Groovewise item mapping", () => {
  test("maps music and podcast episodes into validated playable resources", () => {
    const track = mapGroovewiseItem({ id: "t1", title: "Song", artist: { name: "Artist" }, duration: 122 });
    expect(track).toMatchObject({ id: "t1", upstreamId: "t1", name: "Song", type: "track", playback: true, apps: ["library"], attributes: { artist: "Artist", durationSeconds: 122, upstreamType: "music" } });
    const episode = mapGroovewiseItem({ id: "e2", title: "Episode", type: "podcast_episode" }, "pod1");
    expect(episode).toMatchObject({ id: "episode:pod1:e2", type: "podcast", apps: ["podcasts"], attributes: { podcastId: "pod1", episodeId: "e2", upstreamType: "podcast" } });
    expect(mapGroovewiseItems({ items: [{ id: "x", title: "X" }, { name: "invalid" }] })).toHaveLength(1);
  });
  test("rejects an unknown top-level response shape", () => {
    expect(() => mapGroovewiseItems({ data: [] })).toThrow("invalid item list");
  });
  test("resolves authenticated episode streams and reports provider playback IDs", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const stored = new Map<string, unknown>();
    const runtime: any = {
      instanceId: "gw1", config: { url: "https://groove.example/v1/" },
      secrets: { get: async () => "secret" },
      http: { fetch: async (url: string, init?: RequestInit) => { calls.push({ url, init }); return Response.json({ id: "play-1" }, { status: 201 }); } },
      storage: { get: async (key: string) => stored.get(key), set: async (key: string, value: unknown) => { stored.set(key, value); }, delete: async (key: string) => stored.delete(key) },
    };
    const resource = mapGroovewiseItem({ id: "ep-2", title: "Show", type: "podcast_episode" }, "pod-1")!;
    const result = await (groovewise as any).playback.resolve(runtime, resource, { userId: "u", integrationInstanceId: "gw1", sessionId: "s1", collectionId: "items", resourceId: resource.id });
    expect(result.source.url).toBe("https://groove.example/v1/podcasts/pod-1/episodes/ep-2/stream");
    expect(result.source.auth.headers.Authorization).toBe("Bearer secret");
    await (groovewise as any).playback.listeners.started(runtime, { sessionId: "s1", context: result.context }, { sequence: 1, type: "started", positionSeconds: 9 });
    expect(calls[0]?.url).toBe("https://groove.example/v1/playback/start");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ item_id: "ep-2", item_type: "podcast", time_start: 9 });
    expect(stored.get("playback:s1")).toBe("play-1");
  });
  test("closes pause records, resumes at position, and ends only the active provider record", async () => {
    const calls: Array<{ url: string; body: any }> = [];
    const stored = new Map<string, unknown>();
    let starts = 0;
    const runtime: any = {
      instanceId: "gw1", config: { url: "https://groove.example" }, secrets: { get: async () => "secret" },
      http: { fetch: async (url: string, init?: RequestInit) => {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        calls.push({ url, body });
        return url.endsWith("/playback/start") ? Response.json({ id: `play-${++starts}` }, { status: 201 }) : Response.json({});
      } },
      storage: { get: async (key: string) => stored.get(key), set: async (key: string, value: unknown) => { stored.set(key, value); }, delete: async (key: string) => stored.delete(key) },
    };
    const listeners = (groovewise as any).playback.listeners;
    const context = { sessionId: "s2", context: { itemId: "track-1", itemType: "music" } };
    await listeners.started(runtime, context, { sequence: 1, type: "started", positionSeconds: 5 });
    await listeners.paused(runtime, context, { sequence: 2, type: "paused", positionSeconds: 15 });
    await listeners.resumed(runtime, context, { sequence: 3, type: "resumed", positionSeconds: 20 });
    await listeners.ended(runtime, context, { sequence: 4, type: "ended", positionSeconds: 25 });
    await (groovewise as any).playback.dispose(runtime, context);
    expect(calls.map(({ url }) => url.split("/v1")[1])).toEqual([
      "/playback/start", "/playback/end/play-1", "/playback/start", "/playback/end/play-2",
    ]);
    expect(calls[0]?.body).toEqual({ item_id: "track-1", item_type: "music", time_start: 5 });
    expect(calls[1]?.body).toEqual({ end_reason: "pause", time_end: 15 });
    expect(calls[2]?.body).toEqual({ item_id: "track-1", item_type: "music", time_start: 20 });
    expect(calls[3]?.body).toEqual({ end_reason: "trackEnd", time_end: 25 });
    expect(stored.has("playback:s2")).toBe(false);
  });
});
