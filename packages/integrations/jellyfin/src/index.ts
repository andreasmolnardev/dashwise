import { defineIntegration, resourceCollection, type IntegrationsRuntime, type PlaybackEvent, type PlaybackListenerContext, type ResourceRecord } from "@dashwise/integrations-sdk";
import type { JellyfinResource } from "./mapping";
import { fetchJellyfinLibrary } from "./library";

const items = resourceCollection<JellyfinResource>({ persistent: true, shortcuts: true, apps: ["library"] });
type JellyfinRuntime = IntegrationsRuntime<{ serverUrl: string; userId: string }, "accessToken", { items: typeof items }>;
const deviceId = (identity: string) => `dashwise-${identity}`;
async function auth(integrations: JellyfinRuntime, identity = integrations.instanceId) {
  const token = await integrations.secrets.get("accessToken");
  if (!token) throw new Error("Jellyfin access token is missing");
  return { "X-Emby-Token": token, Authorization: `MediaBrowser Client=\"Dashwise\", Device=\"Web\", DeviceId=\"${deviceId(identity)}\", Version=\"1.0\", Token=\"${token}\"` };
}
async function request(integrations: JellyfinRuntime, path: string, init: RequestInit = {}, identity = integrations.instanceId) {
  const base = (await integrations.http.assertSafeUrl(integrations.config.serverUrl, ["http:", "https:"])).toString().replace(/\/$/, "");
  const response = await integrations.http.fetch(`${base}${path}`, { ...init, headers: { ...(await auth(integrations, identity)), ...(init.headers ?? {}) } });
  if (!response.ok) throw new Error(`Jellyfin request failed (${response.status})`);
  return response;
}
function storedContext(context: PlaybackListenerContext) {
  const raw = context.context;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Jellyfin playback context is missing its item ID");
  const value = raw as Record<string, unknown>;
  if (typeof value.itemId !== "string") throw new Error("Jellyfin playback context is missing its item ID");
  return value as { itemId: string; userId: string; playSessionId?: string; mediaSourceId?: string };
}
async function report(integrations: JellyfinRuntime, context: PlaybackListenerContext, event: PlaybackEvent, kind: "start" | "progress" | "stop") {
  const data = storedContext(context);
  const startedKey = `jellyfin:started:${context.sessionId}`;
  const positionKey = `jellyfin:position:${context.sessionId}`;
  const alreadyStarted = await integrations.storage.get(startedKey);
  if (kind === "start" && alreadyStarted) return;
  if (kind !== "start" && !alreadyStarted) return;
  const storedPosition = await integrations.storage.get(positionKey);
  const positionSeconds = event.positionSeconds ?? (typeof storedPosition === "number" ? storedPosition : 0);
  const info = {
    ItemId: data.itemId, UserId: data.userId,
    PlaySessionId: data.playSessionId ?? null, MediaSourceId: data.mediaSourceId ?? null,
    PositionTicks: Math.max(0, Math.round(positionSeconds * 10_000_000)),
    IsPaused: event.type === "paused", CanSeek: true, PlayMethod: "DirectStream",
  };
  await request(integrations, `/Sessions/Playing${kind === "progress" ? "/Progress" : kind === "stop" ? "/Stopped" : ""}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(info) }, context.sessionId);
  if (kind === "start") await integrations.storage.set(startedKey, true);
  if (kind === "progress") await integrations.storage.set(positionKey, positionSeconds);
  if (kind === "stop") {
    await integrations.storage.delete(startedKey);
    await integrations.storage.delete(positionKey);
  }
}

const jellyfin = defineIntegration({
  id: "jellyfin", name: "Jellyfin", version: "1.0.0",
  description: "Browse Jellyfin media and play audio with playback progress reporting.",
  config: {
    serverUrl: { type: "url", required: true, title: "Jellyfin server URL" },
    accessToken: { type: "secret", required: true, title: "User access token" },
    userId: { type: "string", required: true, title: "Jellyfin user ID" },
  },
  resources: { items }, apps: [{ id: "library", name: "Jellyfin Library", icon: "mdi:jellyfin" }],
  async setup(integrations) {
    await integrations.http.assertSafeUrl(integrations.config.serverUrl, ["http:", "https:"]);
    if (!integrations.config.userId || !await integrations.secrets.get("accessToken")) throw new Error("Jellyfin user ID and access token are required");
  },
  async start(integrations) {
    const userId = encodeURIComponent(integrations.config.userId);
    const sync = async () => {
      const resources = await fetchJellyfinLibrary(async (startIndex, limit) => {
        const response = await request(integrations, `/Users/${userId}/Items?Recursive=true&IncludeItemTypes=Audio,Movie,Episode&Fields=RunTimeTicks,MediaSources,Artists,AlbumArtist&StartIndex=${startIndex}&Limit=${limit}`);
        return response.json();
      });
      await integrations.resources.items.sync(resources, { completeness: "complete" });
    };
    await sync();
    integrations.scheduler.every("library-refresh", 15 * 60_000, async (signal) => { if (!signal.aborted) await sync(); });
    integrations.onDispose(() => integrations.scheduler.cancel("library-refresh"));
  },
  playback: {
    async resolve(integrations, resource: ResourceRecord, context) {
      if (resource.type !== "audio") throw new Error("Dashwise playback currently supports Jellyfin audio items only");
      const id = resource.upstreamId ?? resource.id;
      const userId = integrations.config.userId;
      if (!id || !userId) throw new Error("Jellyfin item or user ID is missing");
      const negotiated = await request(integrations, `/Items/${encodeURIComponent(id)}/PlaybackInfo?UserId=${encodeURIComponent(userId)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ UserId: userId, EnableDirectPlay: true, EnableDirectStream: true, EnableTranscoding: true, DeviceProfile: { MaxStreamingBitrate: 120_000_000, DirectPlayProfiles: [{ Type: "Audio", Container: "mp3,flac,m4a,aac,ogg,opus,wav,webm" }] } }),
      }, context.sessionId);
      const result: any = await negotiated.json();
      if (!result || !Array.isArray(result.MediaSources) || result.MediaSources.length === 0) throw new Error("Jellyfin did not return a playable media source");
      const source = result.MediaSources.find((candidate: any) => candidate.SupportsDirectPlay || candidate.SupportsDirectStream || candidate.SupportsTranscoding);
      if (!source?.Id) throw new Error("Jellyfin media source did not include an ID");
      const stream = new URL(`${(await integrations.http.assertSafeUrl(integrations.config.serverUrl, ["http:", "https:"])).toString().replace(/\/$/, "")}/Audio/${encodeURIComponent(id)}/universal`);
      stream.searchParams.set("UserId", userId);
      stream.searchParams.set("DeviceId", deviceId(context.sessionId));
      stream.searchParams.set("MediaSourceId", source.Id);
      if (result.PlaySessionId) stream.searchParams.set("PlaySessionId", result.PlaySessionId);
      stream.searchParams.set("Container", "mp3");
      return {
        source: { url: stream.toString(), auth: { headers: await auth(integrations, context.sessionId) }, kind: "audio" as const, mimeType: "audio/mpeg", metadata: { title: resource.name, artist: typeof resource.attributes?.artist === "string" ? resource.attributes.artist : undefined, durationSeconds: typeof resource.attributes?.durationSeconds === "number" ? resource.attributes.durationSeconds : undefined } },
        context: { itemId: id, userId, playSessionId: result.PlaySessionId, mediaSourceId: source.Id },
      };
    },
    listeners: {
      started: (integrations, context, event) => report(integrations, context, event, "start"),
      progress: (integrations, context, event) => report(integrations, context, event, "progress"),
      paused: (integrations, context, event) => report(integrations, context, event, "progress"),
      resumed: (integrations, context, event) => report(integrations, context, event, "progress"),
      ended: (integrations, context, event) => report(integrations, context, event, "stop"),
      stopped: (integrations, context, event) => report(integrations, context, event, "stop"),
      error: (integrations, context, event) => report(integrations, context, event, "stop"),
    },
    async dispose(integrations, context) {
      const position = await integrations.storage.get(`jellyfin:position:${context.sessionId}`);
      await report(integrations, context, { sequence: 0, type: "stopped", reason: "session_closed", positionSeconds: typeof position === "number" ? position : undefined }, "stop");
    },
  },
});
export default jellyfin;
export { jellyfin };
