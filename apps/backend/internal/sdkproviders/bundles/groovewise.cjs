"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// packages/integrations/groovewise/src/index.ts
var index_exports = {};
__export(index_exports, {
  default: () => index_default,
  groovewise: () => groovewise
});
module.exports = __toCommonJS(index_exports);

// packages/integrations-sdk/index.ts
function resourceCollection(options = {}) {
  return options;
}
function defineIntegration(definition) {
  return definition;
}

// packages/integrations/groovewise/src/mapping.ts
function mapGroovewiseItem(value, parentPodcastId) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value;
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
    apps: [podcast ? "podcasts" : "library"],
    actions: [],
    attributes: {
      ...artist ? { artist } : {},
      ...album ? { album } : {},
      ...typeof duration === "number" && Number.isFinite(duration) ? { durationSeconds: duration } : {},
      upstreamType: podcast ? "podcast" : "music",
      ...podcastId ? { podcastId } : {},
      ...podcast ? { episodeId } : {}
    }
  };
}
function mapGroovewiseItems(value, parentPodcastId) {
  const rows = Array.isArray(value) ? value : isObject(value) && Array.isArray(value.items) ? value.items : null;
  if (!rows) throw new Error("Groovewise returned an invalid item list");
  return rows.map((row) => mapGroovewiseItem(row, parentPodcastId)).filter((item) => item !== null);
}
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// packages/integrations/groovewise/src/index.ts
var items = resourceCollection({ persistent: true, shortcuts: true, apps: ["library", "podcasts"] });
var playbackContext = (context) => {
  const data = context.context;
  if (!data || typeof data !== "object" || Array.isArray(data) || typeof data.itemId !== "string" || typeof data.itemType !== "string") {
    throw new Error("Groovewise playback context is missing its item identity");
  }
  return data;
};
var baseUrl = (value) => value.trim().replace(/\/$/, "").replace(/\/v1$/i, "");
var safeEndpoint = (value) => {
  const endpoint = new URL(value);
  return `${endpoint.origin}${endpoint.pathname}`;
};
var getJson = async (integrations, url, token, description, signal) => {
  const endpoint = safeEndpoint(url);
  const response = await integrations.http.fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    ...signal ? { signal } : {}
  });
  if (!response.ok) throw new Error(`Groovewise ${description} request to ${endpoint} failed (HTTP ${response.status})`);
  try {
    return await response.json();
  } catch {
    const contentType = response.headers.get("content-type") ?? "unknown content type";
    throw new Error(`Groovewise ${description} endpoint ${endpoint} returned invalid JSON (content-type: ${contentType})`);
  }
};
var post = async (integrations, path, body) => {
  const token = await integrations.secrets.get("accessToken");
  if (!token) throw new Error("Groovewise access token is missing");
  const response = await integrations.http.fetch(`${baseUrl(integrations.config.url)}/v1${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`Groovewise request failed (${response.status})`);
  return response;
};
var groovewise = defineIntegration({
  id: "groovewise",
  name: "Groovewise",
  version: "1.0.0",
  description: "Browse and play your Groovewise music and podcast library.",
  config: { url: { type: "url", required: true, title: "Groovewise URL" }, accessToken: { type: "secret", required: true, title: "Access token" } },
  resources: { items },
  apps: [
    { id: "library", name: "Groovewise Music Library", icon: "mdi:music" },
    { id: "podcasts", name: "Groovewise Podcasts", icon: "mdi:podcast" }
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
    const podcasts = await getJson(integrations, `${base}/v1/podcasts`, token, "podcasts");
    const podcastRows = Array.isArray(podcasts) ? podcasts : podcasts && typeof podcasts === "object" && Array.isArray(podcasts.items) ? podcasts.items : null;
    if (!podcastRows) throw new Error("Groovewise returned an invalid podcast list");
    const episodes = [];
    for (const podcast of podcastRows) {
      if (typeof podcast?.id !== "string") continue;
      const podcastUrl = `${base}/v1/podcasts/${encodeURIComponent(podcast.id)}`;
      const details = await getJson(integrations, podcastUrl, token, "podcast details");
      const episodeRows = details && typeof details === "object" && !Array.isArray(details) ? details.episodes : void 0;
      if (!Array.isArray(episodeRows)) throw new Error("Groovewise podcast details did not include an episode list");
      episodes.push(...mapGroovewiseItems(episodeRows, podcast.id));
    }
    await integrations.resources.items.sync([...libraryItems, ...episodes.flat()], { completeness: "complete" });
    integrations.scheduler.every("library-refresh", 15 * 6e4, async (signal) => {
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
    async resolve(integrations, resource) {
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
        source: { url: url.toString(), auth: { headers: { Authorization: `Bearer ${token}` } }, kind: "audio", metadata: { title: resource.name, artist: typeof resource.attributes?.artist === "string" ? resource.attributes.artist : void 0, durationSeconds: typeof resource.attributes?.durationSeconds === "number" ? resource.attributes.durationSeconds : void 0 } },
        context: { itemId: id, itemType }
      };
    },
    listeners: {
      async started(integrations, context, event) {
        const current = await integrations.storage.get(`playback:${context.sessionId}`);
        if (typeof current === "string" && current) return;
        const data = playbackContext(context);
        const response = await post(integrations, "/playback/start", { item_id: data.itemId, item_type: data.itemType, time_start: event.positionSeconds ?? 0 });
        const json = await response.json().catch(() => null);
        if (!json || typeof json !== "object" || typeof json.id !== "string") throw new Error("Groovewise playback start response did not include an ID");
        await integrations.storage.set(`playback:${context.sessionId}`, json.id);
        await integrations.storage.set(`position:${context.sessionId}`, event.positionSeconds ?? 0);
      },
      async progress(integrations, context, event) {
        const stored = await integrations.storage.get(`playback:${context.sessionId}`);
        const id = typeof stored === "string" ? stored : void 0;
        if (!id || typeof event.positionSeconds !== "number") return;
        await post(integrations, `/playback/sync/${encodeURIComponent(id)}`, { sync_at: event.positionSeconds });
        await integrations.storage.set(`position:${context.sessionId}`, event.positionSeconds);
      },
      async paused(integrations, context, event) {
        await finish(integrations, context, event, "pause");
      },
      async resumed(integrations, context, event) {
        const data = playbackContext(context);
        const current = await integrations.storage.get(`playback:${context.sessionId}`);
        if (typeof current === "string" && current) return;
        const position = await integrations.storage.get(`position:${context.sessionId}`);
        const response = await post(integrations, "/playback/start", { item_id: data.itemId, item_type: data.itemType, time_start: event.positionSeconds ?? (typeof position === "number" ? position : 0) });
        const json = await response.json().catch(() => null);
        if (!json || typeof json !== "object" || typeof json.id !== "string") throw new Error("Groovewise playback start response did not include an ID");
        await integrations.storage.set(`playback:${context.sessionId}`, json.id);
      },
      async ended(integrations, context, event) {
        await finish(integrations, context, event, "trackEnd");
      },
      async stopped(integrations, context, event) {
        await finish(integrations, context, event, event.reason === "pause" ? "pause" : "skip");
      },
      async error(integrations, context, event) {
        await finish(integrations, context, event, "skip");
      }
    },
    async dispose(integrations, context) {
      await finish(integrations, context, { sequence: 0, type: "stopped" }, "skip");
      await integrations.storage.delete(`position:${context.sessionId}`);
    }
  }
});
async function finish(integrations, context, event, reason) {
  const key = `playback:${context.sessionId}`;
  const stored = await integrations.storage.get(key);
  const id = typeof stored === "string" ? stored : void 0;
  if (!id) return;
  const position = await integrations.storage.get(`position:${context.sessionId}`);
  const storedPosition = typeof position === "number" ? position : void 0;
  await post(integrations, `/playback/end/${encodeURIComponent(id)}`, { end_reason: reason, time_end: event.positionSeconds ?? storedPosition ?? 0 });
  await integrations.storage.delete(key);
  if (reason === "pause") {
    if (typeof event.positionSeconds === "number") await integrations.storage.set(`position:${context.sessionId}`, event.positionSeconds);
  } else {
    await integrations.storage.delete(`position:${context.sessionId}`);
  }
}
var index_default = groovewise;
