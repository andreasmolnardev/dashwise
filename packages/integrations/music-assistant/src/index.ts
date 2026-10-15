import { defineIntegration, resourceCollection, type ResourceRecord } from "@dashwise/integrations-sdk";
import { mapPlayers, mapRecentItems, type MusicAssistantResource } from "./mapping";

const players = resourceCollection<MusicAssistantResource>({ persistent: true, shortcuts: true, apps: ["players"] });
const library = resourceCollection<MusicAssistantResource>({ persistent: true, shortcuts: true, apps: ["library"] });
async function command(integrations: any, name: string, args: Record<string, unknown> = {}) {
  const token = await integrations.secrets.get("accessToken");
  if (!token) throw new Error("Music Assistant access token is missing");
  const base = (await integrations.http.assertSafeUrl(integrations.config.serverUrl, ["http:", "https:"])).toString().replace(/\/$/, "");
  const response = await integrations.http.fetch(`${base}/api`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ message_id: crypto.randomUUID(), command: name, args }) });
  if (!response.ok) throw new Error(`Music Assistant ${name} failed (${response.status})`);
  const payload: any = await response.json();
  if (payload?.error) throw new Error(`Music Assistant ${name} returned an error`);
  return payload && Object.hasOwn(payload, "result") ? payload.result : payload;
}
function playerId(resource: ResourceRecord) {
  const id = resource.attributes?.playerId;
  if (typeof id !== "string" || !id) throw new Error("Music Assistant player ID is missing");
  return id;
}

const musicAssistant = defineIntegration({
  id: "music-assistant", name: "Music Assistant", version: "1.0.0",
  description: "Control Music Assistant players and send library items to their queues.",
  config: { serverUrl: { type: "url", required: true, title: "Music Assistant server URL" }, accessToken: { type: "secret", required: true, title: "Long-lived access token" } },
  resources: { players, library },
  apps: [{ id: "players", name: "Music Assistant Players", icon: "mdi:speaker-multiple" }, { id: "library", name: "Recently Played", icon: "mdi:music" }],
  actions: {
    play: { id: "play", name: "Resume", async execute(integrations: any, resource: ResourceRecord) { return command(integrations, "player_queues/play", { queue_id: playerId(resource) }); } },
    pause: { id: "pause", name: "Pause", async execute(integrations: any, resource: ResourceRecord) { return command(integrations, "player_queues/pause", { queue_id: playerId(resource) }); } },
    stop: { id: "stop", name: "Stop", async execute(integrations: any, resource: ResourceRecord) { return command(integrations, "player_queues/stop", { queue_id: playerId(resource) }); } },
    next: { id: "next", name: "Next item", async execute(integrations: any, resource: ResourceRecord) { return command(integrations, "player_queues/next", { queue_id: playerId(resource) }); } },
    previous: { id: "previous", name: "Previous item", async execute(integrations: any, resource: ResourceRecord) { return command(integrations, "player_queues/previous", { queue_id: playerId(resource) }); } },
    playOnPlayer: {
      id: "playOnPlayer", name: "Play on Music Assistant player",
      inputSchema: { type: "object", required: ["playerId"], properties: { playerId: { type: "string", minLength: 1 } }, additionalProperties: false },
      async execute(integrations: any, resource: ResourceRecord, input: any) {
        const uri = resource.upstreamId;
        const id = input && typeof input.playerId === "string" ? input.playerId : "";
        if (!uri || !id) throw new Error("Item URI and Music Assistant player ID are required");
        return command(integrations, "player_queues/play_media", { queue_id: id, media: uri });
      },
    },
  },
  async setup(integrations) {
    await integrations.http.assertSafeUrl(integrations.config.serverUrl, ["http:", "https:"]);
    if (!await integrations.secrets.get("accessToken")) throw new Error("Music Assistant long-lived access token is required");
  },
  async start(integrations) {
    const [playerRows, recent] = await Promise.all([
      command(integrations, "players/all"),
      command(integrations, "music/recently_played_items", { limit: 100, media_types: ["track", "album", "podcast_episode"] }),
    ]);
    await integrations.resources.players.sync(mapPlayers(playerRows), { completeness: "complete" });
    await integrations.resources.library.sync(mapRecentItems(recent), { completeness: "complete" });
  },
});
export default musicAssistant;
export { musicAssistant };
