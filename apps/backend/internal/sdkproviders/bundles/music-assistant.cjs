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

// packages/integrations/music-assistant/src/index.ts
var index_exports = {};
__export(index_exports, {
  default: () => index_default,
  musicAssistant: () => musicAssistant
});
module.exports = __toCommonJS(index_exports);

// packages/integrations-sdk/index.ts
function resourceCollection(options = {}) {
  return options;
}
function defineIntegration(definition) {
  return definition;
}

// packages/integrations/music-assistant/src/mapping.ts
function mapPlayers(input) {
  if (!Array.isArray(input)) throw new Error("Music Assistant returned an invalid player list");
  return input.flatMap((raw) => {
    if (!raw || typeof raw.player_id !== "string") return [];
    return [{ id: `player:${raw.player_id}`, upstreamId: raw.player_id, name: raw.name ?? raw.player_id, type: "player", icon: "mdi:speaker", available: raw.available !== false, actions: ["play", "pause", "stop", "next", "previous"], attributes: { playerId: raw.player_id, ...typeof raw.state === "string" ? { state: raw.state } : {} } }];
  });
}
function mapRecentItems(input) {
  if (!Array.isArray(input)) throw new Error("Music Assistant returned an invalid recently played list");
  return input.flatMap((raw) => {
    const id = typeof raw?.uri === "string" && raw.uri.trim() ? raw.uri : null;
    if (!id) return [];
    const mediaType = String(raw.media_type ?? raw.type ?? "track").toLowerCase();
    const type = mediaType.includes("podcast") ? "podcast" : mediaType === "album" ? "album" : "track";
    return [{ id: `item:${id}`, upstreamId: id, name: raw.name ?? raw.title ?? id, type, icon: type === "album" ? "mdi:album" : "mdi:music-note", actions: ["playOnPlayer"], attributes: { uri: id, ...typeof raw.duration === "number" ? { durationSeconds: raw.duration } : {}, ...typeof raw.artist === "string" ? { artist: raw.artist } : {} } }];
  });
}

// packages/integrations/music-assistant/src/index.ts
var players = resourceCollection({ persistent: true, shortcuts: true, apps: ["players"] });
var library = resourceCollection({ persistent: true, shortcuts: true, apps: ["library"] });
async function command(integrations, name, args = {}) {
  const token = await integrations.secrets.get("accessToken");
  if (!token) throw new Error("Music Assistant access token is missing");
  const base = (await integrations.http.assertSafeUrl(integrations.config.serverUrl, ["http:", "https:"])).toString().replace(/\/$/, "");
  const response = await integrations.http.fetch(`${base}/api`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ message_id: crypto.randomUUID(), command: name, args }) });
  if (!response.ok) throw new Error(`Music Assistant ${name} failed (${response.status})`);
  const payload = await response.json();
  if (payload?.error) throw new Error(`Music Assistant ${name} returned an error`);
  return payload && Object.hasOwn(payload, "result") ? payload.result : payload;
}
function playerId(resource) {
  const id = resource.attributes?.playerId;
  if (typeof id !== "string" || !id) throw new Error("Music Assistant player ID is missing");
  return id;
}
var musicAssistant = defineIntegration({
  id: "music-assistant",
  name: "Music Assistant",
  version: "1.0.0",
  description: "Control Music Assistant players and send library items to their queues.",
  config: { serverUrl: { type: "url", required: true, title: "Music Assistant server URL" }, accessToken: { type: "secret", required: true, title: "Long-lived access token" } },
  resources: { players, library },
  apps: [{ id: "players", name: "Music Assistant Players", icon: "mdi:speaker-multiple" }, { id: "library", name: "Recently Played", icon: "mdi:music" }],
  actions: {
    play: { id: "play", name: "Resume", async execute(integrations, resource) {
      return command(integrations, "player_queues/play", { queue_id: playerId(resource) });
    } },
    pause: { id: "pause", name: "Pause", async execute(integrations, resource) {
      return command(integrations, "player_queues/pause", { queue_id: playerId(resource) });
    } },
    stop: { id: "stop", name: "Stop", async execute(integrations, resource) {
      return command(integrations, "player_queues/stop", { queue_id: playerId(resource) });
    } },
    next: { id: "next", name: "Next item", async execute(integrations, resource) {
      return command(integrations, "player_queues/next", { queue_id: playerId(resource) });
    } },
    previous: { id: "previous", name: "Previous item", async execute(integrations, resource) {
      return command(integrations, "player_queues/previous", { queue_id: playerId(resource) });
    } },
    playOnPlayer: {
      id: "playOnPlayer",
      name: "Play on Music Assistant player",
      inputSchema: { type: "object", required: ["playerId"], properties: { playerId: { type: "string", minLength: 1 } }, additionalProperties: false },
      async execute(integrations, resource, input) {
        const uri = resource.upstreamId;
        const id = input && typeof input.playerId === "string" ? input.playerId : "";
        if (!uri || !id) throw new Error("Item URI and Music Assistant player ID are required");
        return command(integrations, "player_queues/play_media", { queue_id: id, media: uri });
      }
    }
  },
  async setup(integrations) {
    await integrations.http.assertSafeUrl(integrations.config.serverUrl, ["http:", "https:"]);
    if (!await integrations.secrets.get("accessToken")) throw new Error("Music Assistant long-lived access token is required");
  },
  async start(integrations) {
    const [playerRows, recent] = await Promise.all([
      command(integrations, "players/all"),
      command(integrations, "music/recently_played_items", { limit: 100, media_types: ["track", "album", "podcast_episode"] })
    ]);
    await integrations.resources.players.sync(mapPlayers(playerRows), { completeness: "complete" });
    await integrations.resources.library.sync(mapRecentItems(recent), { completeness: "complete" });
  }
});
var index_default = musicAssistant;
