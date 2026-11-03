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

// packages/integrations/jellyfin/src/index.ts
var index_exports = {};
__export(index_exports, {
  default: () => index_default,
  jellyfin: () => jellyfin
});
module.exports = __toCommonJS(index_exports);

// packages/integrations-sdk/index.ts
function resourceCollection(options = {}) {
  return options;
}
function defineIntegration(definition) {
  return definition;
}

// packages/integrations/jellyfin/src/mapping.ts
function mapJellyfinItem(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value;
  if (typeof item.Id !== "string" || !item.Id || typeof item.Type !== "string") return null;
  if (!["Audio", "Movie", "Episode"].includes(item.Type)) return null;
  return {
    id: item.Id,
    upstreamId: item.Id,
    name: item.Name ?? item.Id,
    type: item.Type.toLowerCase(),
    icon: item.Type === "Audio" ? "mdi:music-note" : "mdi:movie-open",
    actions: [],
    attributes: {
      itemType: item.Type,
      ...item.AlbumArtist ?? item.Artists?.[0] ? { artist: item.AlbumArtist ?? item.Artists?.[0] } : {},
      ...typeof item.RunTimeTicks === "number" ? { durationSeconds: item.RunTimeTicks / 1e7 } : {}
    }
  };
}
function mapJellyfinItems(value) {
  const rows = value && typeof value === "object" && !Array.isArray(value) && Array.isArray(value.Items) ? value.Items : null;
  if (!rows) throw new Error("Jellyfin returned an invalid item list");
  return rows.map(mapJellyfinItem).filter((item) => item !== null);
}

// packages/integrations/jellyfin/src/library.ts
async function fetchJellyfinLibrary(fetchPage, pageSize = 500) {
  const resources = /* @__PURE__ */ new Map();
  let startIndex = 0;
  while (true) {
    const response = await fetchPage(startIndex, pageSize);
    if (!response || typeof response !== "object" || Array.isArray(response) || !Array.isArray(response.Items)) {
      throw new Error("Jellyfin returned an invalid item list");
    }
    const page = response;
    for (const resource of mapJellyfinItems(response)) resources.set(resource.id, resource);
    const count = page.Items.length;
    const total = typeof page.TotalRecordCount === "number" && Number.isSafeInteger(page.TotalRecordCount) && page.TotalRecordCount >= 0 ? page.TotalRecordCount : void 0;
    if (count === 0 || (total !== void 0 ? startIndex + count >= total : count < pageSize)) break;
    startIndex += count;
  }
  return [...resources.values()];
}

// packages/integrations/jellyfin/src/index.ts
var items = resourceCollection({ persistent: true, shortcuts: true, apps: ["library"] });
var deviceId = (identity) => `dashwise-${identity}`;
async function auth(integrations, identity = integrations.instanceId) {
  const token = await integrations.secrets.get("accessToken");
  if (!token) throw new Error("Jellyfin access token is missing");
  return { "X-Emby-Token": token, Authorization: `MediaBrowser Client="Dashwise", Device="Web", DeviceId="${deviceId(identity)}", Version="1.0", Token="${token}"` };
}
async function request(integrations, path, init = {}, identity = integrations.instanceId) {
  const base = (await integrations.http.assertSafeUrl(integrations.config.serverUrl, ["http:", "https:"])).toString().replace(/\/$/, "");
  const response = await integrations.http.fetch(`${base}${path}`, { ...init, headers: { ...await auth(integrations, identity), ...init.headers ?? {} } });
  if (!response.ok) throw new Error(`Jellyfin request failed (${response.status})`);
  return response;
}
var jellyfin = defineIntegration({
  id: "jellyfin",
  name: "Jellyfin",
  version: "1.0.0",
  description: "Browse your Jellyfin media library.",
  config: {
    serverUrl: { type: "url", required: true, title: "Jellyfin server URL" },
    accessToken: { type: "secret", required: true, title: "User access token" },
    userId: { type: "string", required: true, title: "Jellyfin user ID" }
  },
  resources: { items },
  apps: [{ id: "library", name: "Jellyfin Library", icon: "mdi:jellyfin" }],
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
    integrations.scheduler.every("library-refresh", 15 * 6e4, async (signal) => {
      if (!signal.aborted) await sync();
    });
    integrations.onDispose(() => integrations.scheduler.cancel("library-refresh"));
  }
});
var index_default = jellyfin;
