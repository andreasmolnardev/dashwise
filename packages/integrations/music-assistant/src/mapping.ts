import type { ResourceRecord } from "@dashwise/integrations-sdk";
export type MusicAssistantResource = ResourceRecord & { upstreamId: string; type: "player" | "track" | "album" | "podcast"; attributes: Record<string, string | number | boolean> };

export function mapPlayers(input: unknown): MusicAssistantResource[] {
  if (!Array.isArray(input)) throw new Error("Music Assistant returned an invalid player list");
  return input.flatMap((raw: any) => {
    if (!raw || typeof raw.player_id !== "string") return [];
    return [{ id: `player:${raw.player_id}`, upstreamId: raw.player_id, name: raw.name ?? raw.player_id, type: "player" as const, icon: "mdi:speaker", available: raw.available !== false, actions: ["play", "pause", "stop", "next", "previous"], attributes: { playerId: raw.player_id, ...(typeof raw.state === "string" ? { state: raw.state } : {}) } }];
  });
}

export function mapRecentItems(input: unknown): MusicAssistantResource[] {
  if (!Array.isArray(input)) throw new Error("Music Assistant returned an invalid recently played list");
  return input.flatMap((raw: any) => {
    const id = typeof raw?.uri === "string" && raw.uri.trim() ? raw.uri : null;
    if (!id) return [];
    const mediaType = String(raw.media_type ?? raw.type ?? "track").toLowerCase();
    const type = mediaType.includes("podcast") ? "podcast" : mediaType === "album" ? "album" : "track";
    return [{ id: `item:${id}`, upstreamId: id, name: raw.name ?? raw.title ?? id, type, icon: type === "album" ? "mdi:album" : "mdi:music-note", actions: ["playOnPlayer"], attributes: { uri: id, ...(typeof raw.duration === "number" ? { durationSeconds: raw.duration } : {}), ...(typeof raw.artist === "string" ? { artist: raw.artist } : {}) } }];
  });
}
