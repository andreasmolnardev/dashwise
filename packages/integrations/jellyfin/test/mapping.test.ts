import { describe, expect, test } from "bun:test";
import { mapJellyfinItem, mapJellyfinItems } from "../src/mapping";

describe("Jellyfin item mapping", () => {
  test("keeps audio and video with runtime metadata", () => {
    expect(mapJellyfinItem({ Id: "a1", Name: "Track", Type: "Audio", AlbumArtist: "Artist", RunTimeTicks: 30_000_000 })).toMatchObject({ id: "a1", upstreamId: "a1", type: "audio", attributes: { artist: "Artist", durationSeconds: 3 } });
    expect(mapJellyfinItem({ Id: "m1", Name: "Film", Type: "Movie" })).toMatchObject({ type: "movie", actions: [] });
    expect(mapJellyfinItem({ Id: "lib", Type: "MusicAlbum" })).toBeNull();
  });
  test("validates the Items envelope", () => {
    expect(() => mapJellyfinItems({ Items: [] })).not.toThrow();
    expect(() => mapJellyfinItems([])).toThrow("invalid item list");
  });
});
