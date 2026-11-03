import { defineIntegration, resourceCollection, type IntegrationsRuntime } from "@dashwise/integrations-sdk";
import { fetchJellyfinLibrary } from "./library";
import type { JellyfinResource } from "./mapping";

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

const jellyfin = defineIntegration({
  id: "jellyfin", name: "Jellyfin", version: "1.0.0",
  description: "Browse your Jellyfin media library.",
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
});
export default jellyfin;
export { jellyfin };
