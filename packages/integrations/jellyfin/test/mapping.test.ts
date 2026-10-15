import { describe, expect, test } from "bun:test";
import { mapJellyfinItem, mapJellyfinItems } from "../src/mapping";
import jellyfin from "../src/index";

describe("Jellyfin item mapping", () => {
  test("keeps playable audio and video with runtime metadata", () => {
    expect(mapJellyfinItem({ Id: "a1", Name: "Track", Type: "Audio", AlbumArtist: "Artist", RunTimeTicks: 30_000_000 })).toMatchObject({ id: "a1", upstreamId: "a1", type: "audio", playback: true, attributes: { artist: "Artist", durationSeconds: 3 } });
    expect(mapJellyfinItem({ Id: "m1", Name: "Film", Type: "Movie" })).toMatchObject({ type: "movie", actions: [] });
    expect(mapJellyfinItem({ Id: "m1", Name: "Film", Type: "Movie" })?.playback).toBeUndefined();
    expect(mapJellyfinItem({ Id: "lib", Type: "MusicAlbum" })).toBeNull();
  });
  test("validates the Items envelope", () => {
    expect(() => mapJellyfinItems({ Items: [] })).not.toThrow();
    expect(() => mapJellyfinItems([])).toThrow("invalid item list");
  });
  test("negotiates an audio source before building the authenticated universal stream", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const runtime: any = {
      instanceId: "jf1", config: { serverUrl: "https://jelly.example/jf", userId: "user-1" },
      secrets: { get: async () => "token" },
      http: {
        assertSafeUrl: async (url: string) => new URL(url),
        fetch: async (url: string, init?: RequestInit) => {
          calls.push({ url, init });
          return Response.json({ PlaySessionId: "play-session", MediaSources: [{ Id: "source-1", Container: "flac", SupportsDirectPlay: true }] });
        },
      },
    };
    const resource = mapJellyfinItem({ Id: "audio-1", Name: "Track", Type: "Audio" })!;
    const result = await (jellyfin as any).playback.resolve(runtime, resource, { userId: "u", integrationInstanceId: "jf1", sessionId: "session-2", collectionId: "items", resourceId: "audio-1" });
    const parsed = new URL(result.source.url);
    expect(calls[0]?.url).toBe("https://jelly.example/jf/Items/audio-1/PlaybackInfo?UserId=user-1");
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({ UserId: "user-1", EnableDirectPlay: true, EnableDirectStream: true });
    expect(parsed.pathname).toBe("/jf/Audio/audio-1/universal");
    expect(parsed.searchParams.get("MediaSourceId")).toBe("source-1");
    expect(parsed.searchParams.get("PlaySessionId")).toBe("play-session");
    expect(parsed.searchParams.get("Container")).toBe("mp3");
    expect(result.source.auth.headers["X-Emby-Token"]).toBe("token");
    expect(result.source.auth.headers.Authorization).toContain('DeviceId="dashwise-session-2"');
  });
  test("reports lifecycle ticks once and omits a fabricated Jellyfin session ID", async () => {
    const calls: Array<{ url: string; body: any }> = [];
    const stored = new Map<string, unknown>();
    const runtime: any = {
      instanceId: "jf1", config: { serverUrl: "https://jelly.example", userId: "user-1" }, secrets: { get: async () => "token" },
      storage: { get: async (key: string) => stored.get(key), set: async (key: string, value: unknown) => { stored.set(key, value); }, delete: async (key: string) => stored.delete(key) },
      http: { assertSafeUrl: async (url: string) => new URL(url), fetch: async (url: string, init?: RequestInit) => { calls.push({ url, body: JSON.parse(String(init?.body)) }); return Response.json({}); } },
    };
    const context = { sessionId: "session-3", context: { itemId: "audio-1", userId: "user-1", playSessionId: "ps-1", mediaSourceId: "ms-1" } };
    const listeners = (jellyfin as any).playback.listeners;
    await listeners.started(runtime, context, { sequence: 1, type: "started" });
    await listeners.progress(runtime, context, { sequence: 2, type: "progress", positionSeconds: 12 });
    await listeners.stopped(runtime, context, { sequence: 3, type: "stopped", positionSeconds: 13 });
    await listeners.ended(runtime, context, { sequence: 4, type: "ended", positionSeconds: 13 });
    await (jellyfin as any).playback.dispose(runtime, context);
    expect(calls.map(({ url }) => new URL(url).pathname)).toEqual(["/Sessions/Playing", "/Sessions/Playing/Progress", "/Sessions/Playing/Stopped"]);
    expect(calls[1]?.body.PositionTicks).toBe(120_000_000);
    expect(calls[2]?.body).toMatchObject({ ItemId: "audio-1", UserId: "user-1", PlaySessionId: "ps-1", MediaSourceId: "ms-1", PositionTicks: 130_000_000 });
    expect(calls[0]?.body.SessionId).toBeUndefined();
  });
});
