import { describe, expect, test } from "bun:test";
import { mapPlayers, mapRecentItems } from "../src/mapping";
import musicAssistant from "../src/index";

describe("Music Assistant mapping", () => {
  test("maps player IDs for remote queue control", () => {
    expect(mapPlayers([{ player_id: "speaker-1", name: "Kitchen", available: true }, {}])).toMatchObject([{ id: "player:speaker-1", upstreamId: "speaker-1", name: "Kitchen", type: "player", actions: ["play", "pause", "stop", "next", "previous"] }]);
  });
  test("maps API URIs without claiming native playback support", () => {
    const item = mapRecentItems([{ uri: "library://track/42", name: "Track", media_type: "track" }])[0];
    expect(item).toMatchObject({ upstreamId: "library://track/42", type: "track", actions: ["playOnPlayer"] });
    expect(item?.playback).toBeUndefined();
    expect(() => mapRecentItems({ items: [] })).toThrow("invalid recently played list");
    expect(mapRecentItems([{ item_id: "42", name: "No URI" }])).toEqual([]);
  });
  test("sends a library URI to a chosen MA queue through the documented command API", async () => {
    let call: { url: string; init?: RequestInit } | undefined;
    const runtime: any = {
      config: { serverUrl: "http://music.example:8095" }, secrets: { get: async () => "token" },
      http: { assertSafeUrl: async (url: string) => new URL(url), fetch: async (url: string, init?: RequestInit) => { call = { url, init }; return Response.json({ message_id: "1", result: true }); } },
    };
    const resource = mapRecentItems([{ uri: "library://track/42", name: "Track" }])[0]!;
    await (musicAssistant as any).actions?.playOnPlayer.execute(runtime, resource, { playerId: "speaker-1" });
    expect(call?.url).toBe("http://music.example:8095/api");
    expect(JSON.parse(String(call?.init?.body))).toMatchObject({ command: "player_queues/play_media", args: { queue_id: "speaker-1", media: "library://track/42" } });
    expect(new Headers(call?.init?.headers).get("Authorization")).toBe("Bearer token");
  });
});
