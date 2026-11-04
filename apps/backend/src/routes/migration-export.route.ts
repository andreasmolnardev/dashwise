import { Hono } from "hono";
import { getSuperuserPB } from "../lib/pb/pocketbase";
import { requireUserAuth } from "../lib/data/auth";
import { readAuthToken } from "./shared";

const collections: Array<[string, string]> = [
  ["linksLists", "links_collections"], ["linksFolders", "links_folders"], ["linksTags", "links_tags"],
  ["linkItems", "link_items"], ["linkRssFeeds", "links_rss_feeds"],
  ["newsSubscriptions", "news_subscriptions"], ["newsFeeds", "news_feeds"], ["newsSavedArticles", "news_articles"],
  ["newsSavedArticleLists", "news_saved_lists"], ["newsTopics", "news_preferences"],
  ["monitors", "monitors"], ["monitoringJobs", "monitor_pings"], ["monitoringHosts", "monitoring_hosts"],
  ["monitoringHostsStats", "monitoring_host_stats"], ["notificationTopics", "notification_topics"],
  ["notificationItems", "notification_items"], ["notificationTopicTokens", "notification_topic_tokens"],
  ["notificationForwarders", "notification_forwarders"], ["activities", "activities"], ["integrations", "integrations"],
  ["sdkStorage", "sdk_storage"], ["pageConfig", "page_configs"], ["savedViews", "saved_views"],
  ["resources", "resources"], ["activityDefinitionSettings", "activity_definition_settings"], ["wallpaperStore", "wallpapers"],
];

const aliases: Record<string, string> = {
  user: "owner_id", userId: "owner_id", associatedUserId: "owner_id", ownerId: "owner_id",
  list: "list_id", parentFolder: "parent_folder_id", collection: "list_id", tagIds: "tag_ids_json",
  endpointAuth: "endpoint_auth_plain", endpointAuthPlain: "endpoint_auth_plain", environmentCipher: "environment_cipher",
  topic: "topic_id", topicId: "topic_id", monitor: "monitor_id", integration: "integration_instance_id",
  fileName: "file_name", mimeType: "mime_type", created: "created_at", updated: "updated_at",
};

function snake(key: string) { return aliases[key] ?? key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`); }

function normalized(record: Record<string, any>) {
  const row: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (["collectionId", "expand", "email", "emailVisibility", "verified", "password", "passwordConfirm", "tokenKey", "totpSecret"].includes(key)) continue;
    row[snake(key)] = value;
  }
  delete row.owner_id;
  delete row.user_id;
  if (record.environment_cipher) {
    try { row.environment = JSON.parse(record.environment_cipher); } catch { row.environment = record.environment_cipher; }
    delete row.environment_cipher;
  }
  return row;
}

const route = new Hono();
route.get("/api/v1/migration/export", async (c) => {
  try {
    const { userId } = await requireUserAuth({ token: readAuthToken(c) });
    const pb = await getSuperuserPB();
    const tables: Record<string, Record<string, unknown>[]> = {};
    for (const [collection, table] of collections) {
      try {
        let records;
        for (const field of ["user", "userId", "associatedUserId", "owner"]) {
          try {
            records = await pb.collection(collection).getFullList({ filter: `${field} = "${userId}"` });
            break;
          } catch { /* try the collection's other legacy owner field */ }
        }
        tables[table] = (records ?? []).map((record) => normalized(record as unknown as Record<string, any>));
      } catch {
        // Older installations may not have collections added in later versions.
        tables[table] = [];
      }
    }
    // Some legacy collections use a related record id as owner and have several
    // naming variants; explicitly re-query the known relation fields where needed.
    const user = await pb.collection("users").getOne(userId);
    const props = ["appearancePreferences", "localizationPreferences", "screensaverPreferences", "searchPreferences", "newsPreferences", "global"];
    tables.auth_user_properties = props.flatMap((property) => user[property]
      ? [{ property_name: property, value_json: JSON.stringify(user[property]) }]
      : []);
    for (const [collection, table, field] of [["wallpaperStore", "wallpapers", "userId"], ["pageConfig", "page_configs", "associatedUserId"]]) {
      try {
        const records = await pb.collection(collection).getFullList({ filter: `${field} = "${userId}"` });
        const ids = new Set(tables[table].map((row) => row.id));
        for (const record of records) if (!ids.has(record.id)) tables[table].push(normalized(record as unknown as Record<string, any>));
      } catch { /* collection not present */ }
    }
    // Legacy wallpaper files are embedded so the Go instance does not depend on PB URLs.
    for (const row of tables.wallpapers ?? []) {
      const filename = String(row.image ?? row.file_name ?? "");
      if (!filename) continue;
      try {
        const record = await pb.collection("wallpaperStore").getOne(String(row.id));
        const url = pb.files.getURL(record, filename);
        const response = await fetch(url);
        if (response.ok) row.contentsBase64 = Buffer.from(await response.arrayBuffer()).toString("base64");
      } catch { /* retain metadata when an old file is unavailable */ }
    }
    const archive = { format: "dashwise-pocketbase-export", version: 1, exportedAt: new Date().toISOString(), source: "dashwise-pocketbase", tables };
    return c.body(JSON.stringify(archive, null, 2), 200, {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="dashwise-pocketbase-export-${new Date().toISOString().slice(0, 10)}.json"`,
      "cache-control": "private, no-store",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Export failed";
    return c.json({ error: message }, message === "Unauthorized" ? 401 : 500);
  }
});

export default route;
