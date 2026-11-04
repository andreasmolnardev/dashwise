import { Hono } from "hono";
import { getSuperuserPB } from "../lib/pb/pocketbase";
import { requireUserAuth } from "../lib/data/auth";
import { readAuthToken } from "./shared";
import { decryptSecret } from "../lib/crypto";
import { createHash } from "node:crypto";
import YAML from "yaml";

const collections: Array<[string, string]> = [
  ["linksLists", "links_collections"], ["linksFolders", "links_folders"], ["linksTags", "links_tags"],
  ["linkItems", "link_items"], ["linkRssFeeds", "links_rss_feeds"],
  ["newsSubscriptions", "news_subscriptions"], ["newsFeeds", "news_feeds"], ["newsSavedArticles", "news_articles"],
  ["newsSavedArticleLists", "news_saved_lists"],
  ["monitors", "monitors"], ["monitoringHosts", "monitoring_hosts"],
  ["notificationTopics", "notification_topics"],
  ["notificationTopicTokens", "notification_topic_tokens"],
  ["notificationForwarders", "notification_forwarders"], ["activities", "activities"], ["integrations", "integrations"],
  ["sdkIntegrationStorage", "sdk_storage"], ["sdkIntegrationResources", "resources"],
  ["pageConfig", "page_configs"], ["savedViews", "saved_views"],
  ["activityDefinitionSettings", "activity_definition_settings"], ["wallpaperStore", "wallpapers"],
];

const aliases: Record<string, string> = {
  user: "owner_id", userId: "owner_id", associatedUserId: "owner_id", ownerId: "owner_id",
  list: "list_id", parentFolder: "parent_folder_id", collection: "list_id", tagIds: "tag_ids_json", linkIds: "link_ids_json",
  endpointAuth: "endpoint_auth_plain", endpointAuthPlain: "endpoint_auth_plain", environmentCipher: "environment_cipher",
  topic: "topic_id", topicId: "topic_id", monitor: "monitor_id", integration: "integration_instance_id",
  fileName: "file_name", mimeType: "mime_type", created: "created_at", updated: "updated_at",
  config: "config_json", settings: "settings_json", propertyValue: "property_json", value: "value_json",
  folder: "folder_id", iconUrl: "icon_url", tags: "tags_json", secondaryUrls: "secondary_urls_json",
  responseFilter: "response_filter_json", outliers: "outlier_json", avgLatency: "avg_latency_json",
  notifyTopicId: "notify_topic_id", notifyOnChange: "notify_on_change", systemInfo: "system_info_json",
  stats: "stats_json", content: "content_json", savedAt: "created_at",
  maxFeedItems: "max_items", feedType: "feed_type", systemKey: "system_key",
  localData: "local_data_json", sdkEnabled: "sdk_enabled",
  image: "file_name",
  key: "storage_key", resourceType: "type", resourceId: "provider_resource_id", providerInstanceId: "provider_instance_id",
  provider: "provider", capabilities: "capabilities_json", state: "state", view: "definition_json",
  responseUpFilter: "response_filter_json", pingOutlierThreshold: "outlier_json", pingOutliers: "outlier_json",
  pingAvgLatency: "avg_latency_json",
  instance: "integration_instance_id", resourceCollection: "type", data: "data_json",
  topicId: "topic_id", expires: "expires_at", received: "received_at", forwardStatus: "forward_status",
  metadata: "metadata_json", action: "action_json", notifyOnStatusChange: "notify_on_change", json: "settings_json",
};

const collectionFilters: Record<string, string[]> = {
  notificationItems: ["topic.userId"], notificationTopicTokens: ["topic.userId"], notificationForwarders: ["topic.userId"],
  sdkIntegrationStorage: ["owner"], sdkIntegrationResources: ["owner"],
};

function isMissingCollection(error: unknown) {
  return typeof error === "object" && error !== null && "status" in error && (error as { status?: number }).status === 404;
}

const columns: Record<string, Set<string>> = Object.fromEntries(Object.entries({
  links_collections: "id owner_id name description icon type created_at updated_at",
  links_folders: "id owner_id list_id name icon parent_folder_id position tags_json created_at updated_at",
  links_tags: "id owner_id name color created_at updated_at",
  link_items: "id owner_id list_id url title icon_url description folder_id position favorite tags_json secondary_urls_json created_at updated_at",
  links_rss_feeds: "id owner_id name list_id tag_ids_json link_ids_json requires_auth created_at updated_at",
  news_subscriptions: "id owner_id url title icon settings_json fetch_errors fetch_error_count last_fetched_at created_at updated_at",
  news_feeds: "id owner_id title icon feed_type system_key max_items created_at updated_at",
  news_articles: "id owner_id dedupe_key canonical_url guid title published_at data_json created_at updated_at",
  news_saved_lists: "id owner_id name created_at updated_at", news_feed_subscriptions: "owner_id feed_id subscription_id",
  news_feed_includes: "owner_id feed_id included_feed_id", news_feed_exclusions: "owner_id feed_id subscription_id",
  news_article_sources: "article_id subscription_id last_seen_at", news_saved_list_items: "owner_id list_id article_id created_at",
  news_article_user_state: "owner_id article_id is_read read_at updated_at", news_preferences: "owner_id default_list_id updated_at",
  monitors: "id owner_id title endpoint method link_id status endpoint_auth_plain response_filter_json outlier_json avg_latency_json notify_on_change notify_topic_id created_at updated_at",
  monitor_pings: "id monitor_id status created_at http_status method endpoint latency_ms error is_outlier",
  monitoring_hosts: "id owner_id name hostname port system_info_json token status created_at updated_at",
  monitoring_host_stats: "host_id stats_json updated_at", monitoring_host_history: "id host_id sampled_at source stats_json",
  notification_topics: "id owner_id title priority created_at updated_at", notification_items: "id topic_id content_json status source forward_status created_at received_at",
  notification_topic_tokens: "id topic_id token_hash expires_at created_at", notification_forwarders: "id topic_id target is_active created_at updated_at",
  activities: "id owner_id source source_id event_id idempotency_key type title description severity occurred_at created_at is_current metadata_json action_json",
  integrations: "id owner_id type name source config_json environment local_data_json sdk_enabled created_at updated_at",
  sdk_storage: "owner_id integration_instance_id storage_key value_json updated_at", page_configs: "owner_id page_name config_json created_at updated_at",
  saved_views: "id owner_id name definition_json created_at updated_at", resources: "id owner_id type provider provider_instance_id provider_resource_id data_json capabilities_json state created_at updated_at",
  activity_definition_settings: "owner_id settings_json updated_at", auth_user_properties: "user_id property_name property_json updated_at",
  wallpapers: "owner_id file_name mime_type created_at contentsBase64",
}).map(([table, names]) => [table, new Set(names.split(" "))]));

function snake(key: string) { return aliases[key] ?? key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`); }

function normalized(record: Record<string, any>, table: string) {
  const row: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (["collectionId", "expand", "email", "emailVisibility", "verified", "password", "passwordConfirm", "tokenKey", "totpSecret"].includes(key)) continue;
    const target = snake(key);
    if (!columns[table]?.has(target)) continue;
    row[target] = target.endsWith("_json") && value !== null && typeof value === "object" ? JSON.stringify(value) : value;
  }
  delete row.owner_id;
  delete row.user_id;
  if (table === "integrations") {
    let environment = record.environment ?? {};
    if (typeof environment === "string") {
      if (!environment.trim()) environment = {};
      else if (environment.startsWith("v1:")) environment = decryptSecret(environment) ?? {};
      else {
        try { environment = JSON.parse(environment); } catch {
          try { environment = JSON.parse(Buffer.from(environment, "base64").toString("utf8")); }
          catch { throw new Error("Integration environment could not be decoded"); }
        }
      }
    }
    row.environment = environment && typeof environment === "object" && !Array.isArray(environment) ? environment : {};
  }
  if (table === "monitoring_hosts") {
    const credential = decryptSecret<{ token?: string }>(record.credentialEncrypted);
    if (typeof credential?.token === "string") row.token = credential.token;
  }
  if (table === "notification_topic_tokens" && typeof record.token === "string") {
    row.token_hash = createHash("sha256").update(record.token).digest("hex");
  }
  if (table === "monitors") {
    if (Array.isArray(record.status)) row.status = String(record.status[0] ?? "initiated");
    for (const target of ["response_filter_json", "outlier_json", "avg_latency_json"]) {
      const value = row[target];
      if (value !== null && typeof value === "object") row[target] = JSON.stringify(value);
    }
    if (typeof record.endpointAuth === "string" && record.endpointAuth.startsWith("v1:")) row.endpoint_auth_plain = JSON.stringify(decryptSecret(record.endpointAuth) ?? "");
    else if (record.endpointAuth !== undefined && typeof record.endpointAuth !== "string") row.endpoint_auth_plain = JSON.stringify(record.endpointAuth);
  }
  return row;
}

const route = new Hono();
route.get("/api/v1/migration/export", async (c) => {
  try {
    const { userId } = await requireUserAuth({ token: readAuthToken(c) });
    const pb = await getSuperuserPB();
    const tables: Record<string, Record<string, unknown>[]> = Object.fromEntries(Object.keys(columns).map((table) => [table, []]));
    const skipped: string[] = [];
    const legacyRecords: Record<string, Array<Record<string, any>>> = {};
    let skippedSSHHosts = 0;
    tables.monitor_pings = [];
    tables.monitoring_host_stats = [];
    skipped.push("news_article_sources: legacy saved article snapshots do not retain source subscription links");
    skipped.push("monitoring_host_history: legacy installs do not retain normalized host history rows");
    for (const [collection, table] of collections) {
      try {
        let records;
        let lastError: unknown;
        for (const field of collectionFilters[collection] ?? ["user", "userId", "associatedUserId", "owner"]) {
          try {
            records = await pb.collection(collection).getFullList({ filter: `${field} = "${userId}"` });
            break;
          } catch (error) {
            lastError = error;
            if (isMissingCollection(error)) break;
          }
        }
        if (!records) {
          if (isMissingCollection(lastError)) {
            skipped.push(`${collection}: optional collection is not present`);
            tables[table] ??= [];
            continue;
          }
          throw lastError ?? new Error(`${collection} has no supported owner filter`);
        }
        legacyRecords[collection] = records as unknown as Array<Record<string, any>>;
        tables[table] = records.flatMap((record) => {
          const source = record as unknown as Record<string, any>;
          if (table === "monitoring_hosts" && source.type !== "monitor") {
            skippedSSHHosts++;
            return [];
          }
          const row = normalized(source, table);
          if (table === "links_collections" && !row.type) row.type = String(source.name ?? "").toLowerCase() === "home" ? "home" : "user-defined";
          if (table === "integrations") {
            const configFile = String(source.config ?? "");
            if (!configFile) throw new Error(`Integration ${source.id} has no config file`);
            const configURL = new URL(pb.files.getURL(record, configFile));
            configURL.searchParams.set("token", await pb.files.getToken());
            const response = await fetch(configURL);
            if (!response.ok) throw new Error(`Integration ${source.id} config download failed (${response.status})`);
            const contents = await response.text();
            let parsed: unknown;
            try { parsed = configFile.endsWith(".yaml") || configFile.endsWith(".yml") ? YAML.parse(contents) : JSON.parse(contents); }
            catch { throw new Error(`Integration ${source.id} config is not valid JSON or YAML`); }
            row.config_json = JSON.stringify(parsed ?? {});
          }
          if (table === "resources") {
            row.provider = "sdk";
            row.provider_instance_id = source.instance;
            row.provider_resource_id = source.resourceId;
            row.data_json = JSON.stringify(source.data ?? {});
            row.capabilities_json = "[]";
            row.state = source.stale ? "stale" : "current";
            row.created_at = source.updatedAt ?? source.updated ?? new Date().toISOString();
            row.updated_at = row.created_at;
          }
          if (table === "wallpapers") row.file_name = String(source.image || source.fileName || "");
          if (table === "monitors" && Array.isArray(source.pings)) {
            for (const [index, ping] of source.pings.entries()) tables.monitor_pings.push({
              id: String(ping.id ?? `${source.id}-${index}`), monitor_id: source.id, status: String(ping.status ?? "unknown"),
              created_at: String(ping.created ?? ping.createdAt ?? source.updated ?? source.created ?? new Date().toISOString()),
              http_status: Number(ping.httpStatus ?? 0), method: String(ping.method ?? source.method ?? "GET"), endpoint: String(ping.endpoint ?? source.endpoint ?? ""),
              latency_ms: Number(ping.latencyMs ?? 0), error: String(ping.error ?? ""), is_outlier: ping.isOutlier ? 1 : 0,
            });
          }
          return [row];
        });
      } catch (error) {
        if (isMissingCollection(error)) {
          skipped.push(`${collection}: optional collection is not present`);
          tables[table] = [];
        } else {
          throw new Error(`Could not export ${collection}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    if (skippedSSHHosts) skipped.push(`monitoringHosts: omitted ${skippedSSHHosts} legacy SSH hosts because Go Dashwise has no compatible SSH credential fields`);
    const hostIds = new Set((legacyRecords.monitoringHosts ?? []).filter((host) => host.type === "monitor").map((host) => String(host.id)));
    if (hostIds.size) {
      try {
        const stats = await pb.collection("monitoringHostsStats").getFullList();
        for (const stat of stats as unknown as Array<Record<string, any>>) {
          if (hostIds.has(String(stat.id))) tables.monitoring_host_stats.push({ host_id: stat.id, stats_json: JSON.stringify(stat.stats ?? {}), updated_at: stat.updated ?? new Date().toISOString() });
        }
      } catch (error) {
        if (isMissingCollection(error)) skipped.push("monitoringHostsStats: optional collection is not present");
        else throw new Error(`Could not export monitoring host stats: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const topicIds = new Set((legacyRecords.notificationTopics ?? []).map((topic) => String(topic.id)));
    try {
      const items = await pb.collection("notificationItems").getFullList();
      for (const item of items as unknown as Array<Record<string, any>>) {
        if (!topicIds.has(String(item.topicId ?? ""))) continue;
        tables.notification_items.push(normalized(item, "notification_items"));
      }
    } catch (error) {
      if (isMissingCollection(error)) skipped.push("notificationItems: optional collection is not present");
      else throw new Error(`Could not export notification items: ${error instanceof Error ? error.message : String(error)}`);
    }
    // Legacy newsFeeds records contain subscription and feed relationships as
    // PocketBase relation fields rather than normalized join collections.
    try {
      for (const feed of legacyRecords.newsFeeds ?? []) {
        for (const subscriptionId of Array.isArray(feed.subscriptionRefs) ? feed.subscriptionRefs : []) {
          tables.news_feed_subscriptions.push({ feed_id: feed.id, subscription_id: subscriptionId });
        }
        for (const includedFeedId of Array.isArray(feed.includedFeedRefs) ? feed.includedFeedRefs : []) {
          tables.news_feed_includes.push({ feed_id: feed.id, included_feed_id: includedFeedId });
        }
        for (const subscriptionId of Array.isArray(feed.excludedSubscriptionRefs) ? feed.excludedSubscriptionRefs : []) {
          tables.news_feed_exclusions.push({ feed_id: feed.id, subscription_id: subscriptionId });
        }
      }
    } catch (error) {
      if (isMissingCollection(error)) skipped.push("newsFeeds: optional collection is not present");
      else throw new Error(`Could not export news feed relationships: ${error instanceof Error ? error.message : String(error)}`);
    }
    // PocketBase stored saved articles as snapshots and list memberships as
    // relation IDs. Convert snapshots to normalized article rows and materialize the
    // corresponding Go saved-list memberships.
    const savedListIds = new Set((legacyRecords.newsSavedArticleLists ?? []).map((list) => String(list.id)));
    tables.news_articles = (legacyRecords.newsSavedArticles ?? []).map((article) => {
      const data = article.json && typeof article.json === "object" ? article.json : {};
      const canonicalUrl = String(data.canonicalUrl ?? data.url ?? data.link ?? "");
      const guid = String(data.guid ?? "");
      const dedupeKey = `${canonicalUrl || guid || article.id}#${article.id}`;
      const listIds = Array.isArray(article.list) ? article.list.map(String) : article.list ? [String(article.list)] : [];
      for (const listId of listIds) {
        if (savedListIds.has(listId)) {
          tables.news_saved_list_items.push({ list_id: listId, article_id: article.id, created_at: article.created ?? new Date().toISOString() });
        } else skipped.push(`newsSavedArticles/${article.id}: saved-list reference ${listId} is missing`);
      }
      if (article.isRead) tables.news_article_user_state.push({ article_id: article.id, is_read: 1, read_at: article.updated ?? null, updated_at: article.updated ?? new Date().toISOString() });
      return {
        id: article.id, dedupe_key: dedupeKey, canonical_url: canonicalUrl, guid,
        title: String(data.title ?? ""), published_at: data.publishedAt ?? data.published_at ?? null,
        data_json: JSON.stringify(data), created_at: article.created, updated_at: article.updated,
      };
    });
    // Some legacy collections use a related record id as owner and have several
    // naming variants; explicitly re-query the known relation fields where needed.
    const user = await pb.collection("users").getOne(userId);
    const props = ["appearancePreferences", "localizationPreferences", "screensaverPreferences", "searchPreferences", "newsPreferences", "global"];
    tables.auth_user_properties = props.flatMap((property) => user[property]
      ? [{ property_name: property, property_json: JSON.stringify(user[property]), updated_at: String(user.updated ?? new Date().toISOString()) }]
      : []);
    if (user.newsPreferences && typeof user.newsPreferences === "object") {
      tables.news_preferences = [{ default_list_id: String((user.newsPreferences as Record<string, unknown>).defaultListId ?? ""), updated_at: String(user.updated ?? new Date().toISOString()) }];
    }
    // Legacy wallpaper files are embedded so the Go instance does not depend on PB URLs.
    for (const row of tables.wallpapers ?? []) {
      const filename = String(row.file_name ?? "");
      if (!filename) throw new Error("Could not export wallpaper: missing filename");
      try {
        const record = (legacyRecords.wallpaperStore ?? []).find((candidate) => String(candidate.image ?? candidate.fileName ?? "") === filename);
        if (!record) throw new Error(`Wallpaper ${filename} no longer exists`);
        const url = pb.files.getURL(record, filename);
        const wallpaperURL = new URL(url);
        wallpaperURL.searchParams.set("token", await pb.files.getToken());
        const response = await fetch(wallpaperURL);
        if (!response.ok) throw new Error(`Wallpaper ${filename} could not be downloaded (${response.status})`);
        row.mime_type = response.headers.get("content-type")?.split(";")[0] || "application/octet-stream";
        const contents = Buffer.from(await response.arrayBuffer());
        if (contents.byteLength > 25 * 1024 * 1024) throw new Error(`Wallpaper ${filename} exceeds the 25 MB import limit`);
        row.contentsBase64 = contents.toString("base64");
      } catch (error) { throw new Error(`Could not export wallpaper ${filename}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    const totalRecords = Object.values(tables).reduce((total, rows) => total + rows.length, 0);
    if (totalRecords > 100_000) throw new Error("Archive exceeds the 100,000 record import limit");
    const archive = { format: "dashwise-pocketbase-export", version: 1, exportedAt: new Date().toISOString(), source: "dashwise-pocketbase", tables };
    const archiveJSON = JSON.stringify(archive, null, 2);
    if (Buffer.byteLength(archiveJSON) > 100 * 1024 * 1024) throw new Error("Archive exceeds the 100 MB import limit");
    return c.body(archiveJSON, 200, {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="dashwise-pocketbase-export-${new Date().toISOString().slice(0, 10)}.json"`,
      "cache-control": "private, no-store",
      "x-dashwise-export-warnings": encodeURIComponent(JSON.stringify(skipped.length > 20 ? [...skipped.slice(0, 19), `${skipped.length - 19} additional mapping warnings`] : skipped)),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Export failed";
    return c.json({ error: message }, message === "Unauthorized" ? 401 : 500);
  }
});

export default route;
