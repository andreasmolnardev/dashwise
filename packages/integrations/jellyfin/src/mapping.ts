import type { ResourceRecord } from "@dashwise/integrations-sdk";

export type JellyfinItem = {
  Id: string; Name?: string; Type?: string; AlbumArtist?: string; Artists?: string[]; RunTimeTicks?: number;
  ImageTags?: { Primary?: string }; MediaSources?: Array<{ Id?: string; Container?: string; SupportsDirectPlay?: boolean; SupportsDirectStream?: boolean }>;
};
export type JellyfinResource = ResourceRecord & { upstreamId: string; type: string; playback?: true; attributes: { artist?: string; durationSeconds?: number; itemType: string } };

export function mapJellyfinItem(value: unknown): JellyfinResource | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as JellyfinItem;
  if (typeof item.Id !== "string" || !item.Id || typeof item.Type !== "string") return null;
  if (!["Audio", "Movie", "Episode"].includes(item.Type)) return null;
  const playable = item.Type === "Audio";
  return {
    id: item.Id, upstreamId: item.Id, name: item.Name ?? item.Id, type: item.Type.toLowerCase(),
    icon: item.Type === "Audio" ? "mdi:music-note" : "mdi:movie-open", ...(playable ? { playback: true as const, actions: [] } : { actions: [] }),
    attributes: {
      itemType: item.Type,
      ...(item.AlbumArtist ?? item.Artists?.[0] ? { artist: item.AlbumArtist ?? item.Artists?.[0] } : {}),
      ...(typeof item.RunTimeTicks === "number" ? { durationSeconds: item.RunTimeTicks / 10_000_000 } : {}),
    },
  };
}

export function mapJellyfinItems(value: unknown): JellyfinResource[] {
  const rows = value && typeof value === "object" && !Array.isArray(value) && Array.isArray((value as any).Items) ? (value as any).Items : null;
  if (!rows) throw new Error("Jellyfin returned an invalid item list");
  return rows.map(mapJellyfinItem).filter((item: JellyfinResource | null): item is JellyfinResource => item !== null);
}
