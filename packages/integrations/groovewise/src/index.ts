import { defineIntegration, resourceCollection, type IntegrationsRuntime } from "@dashwise/integrations-sdk";
import { mapGroovewiseItems, type GroovewiseResource } from "./mapping";

const items = resourceCollection<GroovewiseResource>({ persistent: true, shortcuts: true, apps: ["library", "podcasts"] });
type GroovewiseRuntime = IntegrationsRuntime<{ url: string }, "accessToken", { items: typeof items }>;
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

const groovewise = defineIntegration({
  id: "groovewise", name: "Groovewise", version: "1.0.0",
  description: "Browse your Groovewise music and podcast library.",
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
});

export default groovewise;
export { groovewise };
