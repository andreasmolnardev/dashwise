import { defineIntegration, resourceCollection, type IntegrationsRuntime, type PlaybackEvent, type PlaybackListenerContext, type ResourceRecord } from "@dashwise/integrations-sdk";
import { mapGroovewiseItems, type GroovewiseResource } from "./mapping";

const items = resourceCollection<GroovewiseResource>({ persistent: true, shortcuts: true, apps: ["library", "podcasts"] });
type GroovewiseRuntime = IntegrationsRuntime<{ url: string }, "accessToken", { items: typeof items }>;
const playbackContext = (context: PlaybackListenerContext) => {
  const data = context.context as Record<string, unknown> | undefined;
  if (!data || typeof data !== "object" || Array.isArray(data) || typeof data.itemId !== "string" || typeof data.itemType !== "string") {
    throw new Error("Groovewise playback context is missing its item identity");
  }
  return data as { itemId: string; itemType: "music" | "podcast"; playbackId?: string };
};
const baseUrl = (value: string) => value.trim().replace(/\/$/, "").replace(/\/v1$/i, "");
const safeEndpoint = (value: string) => {
  const endpoint = new URL(value);
  return `${endpoint.origin}${endpoint.pathname}`;
};
const getJson = async (integrations: GroovewiseRuntime, url: string, token: string, description: string, signal?: AbortSignal) => {
  const endpoint = safeEndpoint(url);
  const response = await integrations.http.fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error(`Groovewise ${description} request to ${endpoint} failed (HTTP ${response.status})`);
  try {
    return await response.json();
  } catch {
    const contentType = response.headers.get("content-type") ?? "unknown content type";
    throw new Error(`Groovewise ${description} endpoint ${endpoint} returned invalid JSON (content-type: ${contentType})`);
  }
};
const post = async (integrations: GroovewiseRuntime, path: string, body: unknown) => {
  const token = await integrations.secrets.get("accessToken");
  if (!token) throw new Error("Groovewise access token is missing");
  const response = await integrations.http.fetch(`${baseUrl(integrations.config.url)}/v1${path}`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Groovewise request failed (${response.status})`);
  return response;
};

const groovewise = defineIntegration({
  id: "groovewise", name: "Groovewise", version: "1.0.0",
  description: "Browse and play your Groovewise music and podcast library.",
  config: { url: { type: "url", required: true, title: "Groovewise URL" }, accessToken: { type: "secret", required: true, title: "Access token" } },
  resources: { items }, apps: [
    { id: "library", name: "Groovewise Music Library", icon: "mdi:music" },
    { id: "podcasts", name: "Groovewise Podcasts", icon: "mdi:podcast" },
  ],
  async setup(integrations) {
    const token = await integrations.secrets.get("accessToken");
    if (!token) throw new Error("Groovewise access token is required");
    await integrations.http.assertSafeUrl(integrations.config.url, ["http:", "https:"]);
  },
  async start(integrations) {
    const base = baseUrl((await integrations.http.assertSafeUrl(integrations.config.url, ["http:", "https:"])).toString());
    const token = await integrations.secrets.get("accessToken");
    if (!token) throw new Error("Groovewise access token is missing");
    const libraryItems = mapGroovewiseItems(await getJson(integrations, `${base}/v1/items`, token, "library"));
    const podcasts: unknown = await getJson(integrations, `${base}/v1/podcasts`, token, "podcasts");
    const podcastRows = Array.isArray(podcasts) ? podcasts : podcasts && typeof podcasts === "object" && Array.isArray((podcasts as any).items) ? (podcasts as any).items : null;
    if (!podcastRows) throw new Error("Groovewise returned an invalid podcast list");
    const episodes = [];
    for (const podcast of podcastRows as any[]) {
      if (typeof podcast?.id !== "string") continue;
      const podcastUrl = `${base}/v1/podcasts/${encodeURIComponent(podcast.id)}`;
      const details: unknown = await getJson(integrations, podcastUrl, token, "podcast details");
      const episodeRows = details && typeof details === "object" && !Array.isArray(details)
        ? (details as Record<string, unknown>).episodes
        : undefined;
      if (!Array.isArray(episodeRows)) throw new Error("Groovewise podcast details did not include an episode list");
      episodes.push(...mapGroovewiseItems(episodeRows, podcast.id));
    }
    await integrations.resources.items.sync([...libraryItems, ...episodes.flat()], { completeness: "complete" });
    integrations.scheduler.every("library-refresh", 15 * 60_000, async (signal) => {
      if (signal.aborted) return;
      try {
        const refreshed = await getJson(integrations, `${base}/v1/items`, token, "library", signal);
        await integrations.resources.items.sync(mapGroovewiseItems(refreshed), { completeness: "partial" });
      } catch (error) {
        if (!signal.aborted) integrations.logger.warn("Groovewise library refresh failed", { error: String(error) });
      }
    });
    integrations.onDispose(() => integrations.scheduler.cancel("library-refresh"));
  },
  playback: {
    async resolve(integrations, resource: ResourceRecord) {
      const id = resource.upstreamId ?? resource.id;
      if (!id) throw new Error("Groovewise item ID is missing");
      const itemType = resource.type === "podcast" ? "podcast" : "music";
      const podcastId = resource.attributes?.podcastId;
      const episodeId = resource.attributes?.episodeId;
      if (itemType === "podcast" && (typeof podcastId !== "string" || typeof episodeId !== "string")) throw new Error("Groovewise podcast episode identity is incomplete");
      const podcastPath = itemType === "podcast" ? `podcasts/${encodeURIComponent(String(podcastId))}/episodes/${encodeURIComponent(String(episodeId))}/stream` : `items/${encodeURIComponent(id)}/stream`;
      const url = new URL(`${baseUrl(integrations.config.url)}/v1/${podcastPath}`);
      const token = await integrations.secrets.get("accessToken");
      if (!token) throw new Error("Groovewise access token is missing");
      return {
        source: { url: url.toString(), auth: { headers: { Authorization: `Bearer ${token}` } }, kind: "audio" as const, metadata: { title: resource.name, artist: typeof resource.attributes?.artist === "string" ? resource.attributes.artist : undefined, durationSeconds: typeof resource.attributes?.durationSeconds === "number" ? resource.attributes.durationSeconds : undefined } },
        context: { itemId: id, itemType },
      };
    },
    listeners: {
    async started(integrations, context, event: PlaybackEvent) {
      const current = await integrations.storage.get(`playback:${context.sessionId}`);
      if (typeof current === "string" && current) return;
      const data = playbackContext(context);
      const response = await post(integrations, "/playback/start", { item_id: data.itemId, item_type: data.itemType, time_start: event.positionSeconds ?? 0 });
      const json: unknown = await response.json().catch(() => null);
      if (!json || typeof json !== "object" || typeof (json as any).id !== "string") throw new Error("Groovewise playback start response did not include an ID");
      await integrations.storage.set(`playback:${context.sessionId}`, (json as any).id);
      await integrations.storage.set(`position:${context.sessionId}`, event.positionSeconds ?? 0);
    },
    async progress(integrations, context, event: PlaybackEvent) {
      const stored = await integrations.storage.get(`playback:${context.sessionId}`);
      const id = typeof stored === "string" ? stored : undefined;
      if (!id || typeof event.positionSeconds !== "number") return;
      await post(integrations, `/playback/sync/${encodeURIComponent(id)}`, { sync_at: event.positionSeconds });
      await integrations.storage.set(`position:${context.sessionId}`, event.positionSeconds);
    },
    async paused(integrations, context, event: PlaybackEvent) { await finish(integrations, context, event, "pause"); },
    async resumed(integrations, context, event: PlaybackEvent) {
      const data = playbackContext(context);
      const current = await integrations.storage.get(`playback:${context.sessionId}`);
      if (typeof current === "string" && current) return;
      const position = await integrations.storage.get(`position:${context.sessionId}`);
      const response = await post(integrations, "/playback/start", { item_id: data.itemId, item_type: data.itemType, time_start: event.positionSeconds ?? (typeof position === "number" ? position : 0) });
      const json: unknown = await response.json().catch(() => null);
      if (!json || typeof json !== "object" || typeof (json as any).id !== "string") throw new Error("Groovewise playback start response did not include an ID");
      await integrations.storage.set(`playback:${context.sessionId}`, (json as any).id);
    },
    async ended(integrations, context, event: PlaybackEvent) {
      await finish(integrations, context, event, "trackEnd");
    },
    async stopped(integrations, context, event: PlaybackEvent) {
      await finish(integrations, context, event, event.reason === "pause" ? "pause" : "skip");
    },
    async error(integrations, context, event: PlaybackEvent) { await finish(integrations, context, event, "skip"); },
    },
    async dispose(integrations, context) {
      await finish(integrations, context, { sequence: 0, type: "stopped" }, "skip");
      await integrations.storage.delete(`position:${context.sessionId}`);
    },
  },
});

async function finish(integrations: GroovewiseRuntime, context: PlaybackListenerContext, event: PlaybackEvent, reason: "trackEnd" | "skip" | "pause") {
  const key = `playback:${context.sessionId}`;
  const stored = await integrations.storage.get(key);
  const id = typeof stored === "string" ? stored : undefined;
  if (!id) return;
  const position = await integrations.storage.get(`position:${context.sessionId}`);
  const storedPosition = typeof position === "number" ? position : undefined;
  await post(integrations, `/playback/end/${encodeURIComponent(id)}`, { end_reason: reason, time_end: event.positionSeconds ?? storedPosition ?? 0 });
  await integrations.storage.delete(key);
  if (reason === "pause") {
    if (typeof event.positionSeconds === "number") await integrations.storage.set(`position:${context.sessionId}`, event.positionSeconds);
  } else {
    await integrations.storage.delete(`position:${context.sessionId}`);
  }
}

export default groovewise;
export { groovewise };
