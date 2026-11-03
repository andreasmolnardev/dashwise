import { describe, expect, test } from "bun:test";
import { mapGroovewiseItem, mapGroovewiseItems } from "../src/mapping";

describe("Groovewise item mapping", () => {
  test("maps music and podcast episodes into validated resources", () => {
    const track = mapGroovewiseItem({ id: "t1", title: "Song", artist: { name: "Artist" }, duration: 122 });
    expect(track).toMatchObject({ id: "t1", upstreamId: "t1", name: "Song", type: "track", apps: ["library"], attributes: { artist: "Artist", durationSeconds: 122, upstreamType: "music" } });
    const episode = mapGroovewiseItem({ id: "e2", title: "Episode", type: "podcast_episode" }, "pod1");
    expect(episode).toMatchObject({ id: "episode:pod1:e2", type: "podcast", apps: ["podcasts"], attributes: { podcastId: "pod1", episodeId: "e2", upstreamType: "podcast" } });
    expect(mapGroovewiseItems({ items: [{ id: "x", title: "X" }, { name: "invalid" }] })).toHaveLength(1);
  });
  test("rejects an unknown top-level response shape", () => {
    expect(() => mapGroovewiseItems({ data: [] })).toThrow("invalid item list");
  });
});
