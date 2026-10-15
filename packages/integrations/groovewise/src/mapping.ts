import type { ResourceRecord } from "@dashwise/integrations-sdk";

export type GroovewiseItem = {
  id: string;
  podcast_id?: string;
  episode_id?: string;
  podcastId?: string;
  episodeId?: string;
  title?: string;
  name?: string;
  artist?: string | { name?: string };
  album?: string | { title?: string; name?: string };
  duration?: number;
  duration_seconds?: number;
  type?: string;
  item_type?: string;
  thumbnail?: string;
  artwork_url?: string;
  [key: string]: unknown;
};

export type GroovewiseResource = ResourceRecord & {
  upstreamId: string;
  type: "track" | "podcast";
  playback: true;
  attributes: { artist?: string; album?: string; durationSeconds?: number; upstreamType: "music" | "podcast"; podcastId?: string; episodeId?: string };
};

export function mapGroovewiseItem(value: unknown, parentPodcastId?: string): GroovewiseResource | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as GroovewiseItem;
  if (typeof item.id !== "string" || !item.id.trim()) return null;
  const podcast = Boolean(parentPodcastId) || (item.type ?? item.item_type ?? "").toLowerCase().includes("podcast");
  const artist = typeof item.artist === "string" ? item.artist : item.artist?.name;
  const album = typeof item.album === "string" ? item.album : item.album?.title ?? item.album?.name;
  const duration = typeof item.duration_seconds === "number" ? item.duration_seconds : item.duration;
  const podcastId = item.podcast_id ?? item.podcastId ?? parentPodcastId;
  const episodeId = item.episode_id ?? item.episodeId ?? item.id;
  if (podcast && !podcastId) return null;
  return {
    id: podcast ? `episode:${podcastId}:${episodeId}` : item.id,
    upstreamId: item.id,
    name: item.title ?? item.name ?? item.id,
    type: podcast ? "podcast" : "track",
    icon: "mdi:music-note",
    playback: true,
    actions: [],
    attributes: {
      ...(artist ? { artist } : {}),
      ...(album ? { album } : {}),
      ...(typeof duration === "number" && Number.isFinite(duration) ? { durationSeconds: duration } : {}),
      upstreamType: podcast ? "podcast" : "music",
      ...(podcastId ? { podcastId } : {}),
      ...(podcast ? { episodeId } : {}),
    },
  };
}

export function mapGroovewiseItems(value: unknown, parentPodcastId?: string): GroovewiseResource[] {
  const rows = Array.isArray(value) ? value : isObject(value) && Array.isArray(value.items) ? value.items : null;
  if (!rows) throw new Error("Groovewise returned an invalid item list");
  return rows.map((row) => mapGroovewiseItem(row, parentPodcastId)).filter((item): item is GroovewiseResource => item !== null);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
