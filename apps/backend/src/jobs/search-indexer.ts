import { defaultShortcutsManifest } from "@dashwise/assets";
import type { HomeLink } from "@dashwise/types";
import { getHomeLinks } from "@dashwise/sdk/data/links";
import config from "@dashwise/sdk/lib/config";
import { getSuperuserPB } from "@dashwise/sdk/lib/pocketbase";

type SearchItemRow = {
  name: string;
  icon: string;
  secondary: string;
  action: string;
  app: string;
  tags: string[];
  sourceId?: string;
  sourceUpdated?: string;
};

type SearchIndexIntegrationRecord = {
  id: string;
  name?: string | null;
  source?: string | null;
  config?: unknown;
  environment?: unknown;
};

type ShortcutDefaultsRow = {
  name?: unknown;
  icon?: unknown;
  secondary?: unknown;
  secondaryInfo?: unknown;
  action?: unknown;
  tags?: unknown;
};

export async function runSearchItemsIndexing() {
  console.log("Starting search items indexing job...");
  const pb = await getSuperuserPB();
  const users = await pb.collection("users").getFullList<{ id: string }>(500, {
    fields: "id",
  });

  for (const user of users) {
    const userId = user.id;
    if (!userId) continue;

    const rows: SearchItemRow[] = buildDefaultShortcutSearchRows();
    const links = await getHomeLinks(userId).catch(() => [] as HomeLink[]);
    for (const link of links) {
      const name = String(link?.title ?? "").trim();
      const url = String(link?.url ?? "").trim();
      if (!name || !url) continue;

      rows.push({
        name,
        icon: String(link?.iconUrl || link?.folderIcon || "/icons/faGlobe.svg"),
        secondary: String(link?.collection || link?.folder || "Link"),
        action: url.startsWith("url:") ? url : `url:${url}`,
        app: "",
        tags: [
          name,
          String(link?.collection || ""),
          String(link?.folder || ""),
          ...(Array.isArray(link?.tags) ? link.tags.map((tag: unknown) => String(tag)) : []),
        ].filter((tag): tag is string => tag.trim().length > 0),
        sourceId: link.id,
        sourceUpdated: link.updated,
      });
    }

    const enabledIntegrations = await getEnabledIntegrationsMap(pb, userId);
    const integrations = await pb.collection("integrations").getFullList<SearchIndexIntegrationRecord>(500, {
      filter: `user=\"${userId.replace(/"/g, '\\\"')}\"`,
      sort: "-updated",
    });

    for (const integration of integrations) {
      if (!isIntegrationEnabled(integration, enabledIntegrations)) {
        continue;
      }
      try {
        const integrationRows = await buildIntegrationSearchRows(integration);
        rows.push(...integrationRows);
      } catch {
        // If one integration fails to resolve endpoints/search mappings,
        // continue indexing remaining integrations for the user.
        continue;
      }
    }

    await rebuildUserSearchItems(pb, userId, rows);
  }
}

function buildDefaultShortcutSearchRows(): SearchItemRow[] {
  const shortcuts = Array.isArray(defaultShortcutsManifest)
    ? (defaultShortcutsManifest as ShortcutDefaultsRow[])
    : [];

  const rows: SearchItemRow[] = [];
  for (const shortcut of shortcuts) {
    const name = String(shortcut?.name ?? "").trim();
    const action = String(shortcut?.action ?? "").trim();
    if (!name || !action) continue;

    rows.push({
      name,
      icon: String(shortcut?.icon ?? "/icons/faGlobe.svg"),
      secondary: String(shortcut?.secondaryInfo ?? shortcut?.secondary ?? "Dashwise"),
      action,
      app: "",
      tags: [
        name,
        ...(Array.isArray(shortcut?.tags) ? shortcut.tags.map((tag: unknown) => String(tag)) : []),
      ].filter((tag): tag is string => tag.trim().length > 0),
      sourceId: `default-shortcut:${normalizeKey(action)}:${normalizeKey(name)}`,
    });
  }

  return rows;
}

function escapeFilter(value: string) {
  return value.replace(/"/g, '\\"');
}

function normalizeObject(raw: unknown): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, any>;
  if (typeof raw !== "string") return {};

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, any>;
    }
  } catch {
    // noop
  }

  try {
    const decoded = Buffer.from(raw, "base64").toString("utf8");
    const parsed = JSON.parse(decoded);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, any>;
    }
  } catch {
    // noop
  }


  return {};
}

function parseTags(value: unknown) {
  if (!value) return [] as unknown[];
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [] as unknown[];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [] as unknown[];
  }
}

function normalizeKey(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}

function resolveStoredEnvironmentVariables(
  integrationConfig: Record<string, any>,
  rawEnvironment: unknown,
) {
  const envDefinitions =
    integrationConfig?.configuration?.environment_variables &&
    typeof integrationConfig.configuration.environment_variables === "object"
      ? (integrationConfig.configuration.environment_variables as Record<string, any>)
      : {};
  const encoded = normalizeObject(rawEnvironment);

  const resolved: Record<string, string> = {};
  for (const [name] of Object.entries(envDefinitions)) {
    const current = encoded[name];
    if (current !== undefined && current !== null && String(current).trim() !== "") {
      resolved[name] = current;
      continue;
    }
    resolved[name] = "";
  }
  return resolved;
}


async function getEnabledIntegrationsMap(pb: any, userId: string) {
  const pageConfigs = await pb
    .collection("pageConfig")
    .getFullList(200, {
      filter: `associatedUserId="${escapeFilter(userId)}"`,
      fields: "id,config",
    })
    .catch(() => [] as Array<{ config?: Record<string, any> }>);

  const enabled: Record<string, boolean> = {};
  for (const pageConfig of pageConfigs) {
    const integrations =
      pageConfig?.config?.integrations && typeof pageConfig.config.integrations === "object"
        ? (pageConfig.config.integrations as Record<string, unknown>)
        : {};
    for (const [key, value] of Object.entries(integrations)) {
      enabled[normalizeKey(key)] = Boolean(value);
    }
  }

  return enabled;
}

function isIntegrationEnabled(
  integration: SearchIndexIntegrationRecord,
  enabledMap: Record<string, boolean>,
) {
  if (Object.keys(enabledMap).length === 0) {
    return true;
  }

  const integrationConfig = normalizeObject(integration.config);
  const candidates = [
    integration.id,
    integration.name,
    integration.source,
    integrationConfig?.details?.name,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .flatMap((value) => {
      const normalized = normalizeKey(value);
      return [value, normalized].filter(Boolean);
    });

  return candidates.some((candidate) => enabledMap[normalizeKey(candidate)] === true);
}

async function buildIntegrationSearchRows(
  integration: SearchIndexIntegrationRecord,
): Promise<SearchItemRow[]> {
  const integrationConfig = normalizeObject(integration.config);
  const searchDefinitions = Array.isArray(integrationConfig?.configuration?.shortcuts)
    ? (integrationConfig.configuration.shortcuts as Array<Record<string, any>>)
    : [];
  if (searchDefinitions.length === 0) {
    return [];
  }

  const integrationName =
    (typeof integration.name === "string" && integration.name.trim()) ||
    (typeof integrationConfig?.details?.name === "string" && integrationConfig.details.name.trim()) ||
    (typeof integration.source === "string" && integration.source.trim()) ||
    "Integration";
  const integrationIcon =
    typeof integrationConfig?.details?.icon === "string" && integrationConfig.details.icon.trim()
      ? integrationConfig.details.icon
      : "/icons/faGlobe.svg";

  const env = resolveStoredEnvironmentVariables(integrationConfig, integration.environment);

  const shortcutRows = await import("@dashwise/integrationskit/Shortcuts").then(({ default: Shortcuts }) => Shortcuts({
    integrationDefinition: integrationConfig,
    env,
    allowInsecureEndpoints: config.allowInsecureCertsForIntegrationUrls,
  }));

  const appId = `integration:${integration.id}`;
  const rows = shortcutRows.map((item) => ({
    name: item.name,
    icon: item.icon || integrationIcon,
    secondary: item.secondaryInfo || integrationName,
    action: serializeShortcutAction(item.action),
    app: appId,
    tags: item.tags,
    sourceId: integration.id,
    sourceUpdated: (integration as any).updated as string,
  }));

  return [
    {
      name: integrationName,
      icon: integrationIcon,
      secondary: "Integration",
      action: `app:${appId}`,
      app: "",
      tags: [integrationName, "integration"],
      sourceId: integration.id,
      sourceUpdated: (integration as any).updated as string,
    },
    ...rows,
  ];
}

async function rebuildUserSearchItems(pb: any, userId: string, rows: SearchItemRow[]) {
  const existing = await pb.collection("searchItems").getFullList(1000, {
    filter: `user="${escapeFilter(userId)}"`,
  });

  const existingBySource = new Map<string, any[]>();
  for (const record of existing) {
    const sid = record.sourceId || "legacy";
    if (!existingBySource.has(sid)) existingBySource.set(sid, []);
    existingBySource.get(sid)!.push(record);
  }

  const newBySource = new Map<string, SearchItemRow[]>();
  for (const row of rows) {
    const sid = row.sourceId || "unknown";
    if (!newBySource.has(sid)) newBySource.set(sid, []);
    newBySource.get(sid)!.push(row);
  }

  // 1. Clean up search items whose sources no longer exist
  for (const [sid, records] of existingBySource.entries()) {
    if (sid === "legacy") {
      for (const r of records) await pb.collection("searchItems").delete(r.id).catch(() => {});
      continue;
    }
    if (!newBySource.has(sid)) {
      for (const r of records) await pb.collection("searchItems").delete(r.id).catch(() => {});
    }
  }

  // 2. Process new rows
  for (const [sid, newRows] of newBySource.entries()) {
    const existingRecords = existingBySource.get(sid) || [];

    // Determine if it's a link or integration
    const isLink = newRows.length === 1 && newRows[0].app === "" && newRows[0].action.startsWith("url:");
    
    if (isLink) {
      const newRow = newRows[0];
      const existingRecord = existingRecords[0];

      if (existingRecord) {
        // "check if the parent link has been updated since the search item has lastly been updated. if yes replace, else discard"
        const sourceUpdated = new Date(newRow.sourceUpdated || 0).getTime();
        const itemUpdated = new Date(existingRecord.updated).getTime();

        if (sourceUpdated <= itemUpdated) {
          // Discard (keep existing)
          continue;
        }
        
        // Replace
        await pb.collection("searchItems").delete(existingRecord.id).catch(() => {});
      }

      await pb.collection("searchItems").create({
        user: userId,
        name: newRow.name,
        icon: newRow.icon,
        secondary: newRow.secondary,
        action: newRow.action,
        app: newRow.app || null,
        tags: JSON.stringify(newRow.tags ?? []),
        sourceId: sid,
        sourceUpdated: newRow.sourceUpdated,
      });
    } else {
      // Integration logic: "regenerate every time and check whether the output differs"
      const existingData = existingRecords.map(r => ({
        name: r.name,
        icon: r.icon,
        secondary: r.secondary,
        action: r.action,
        app: r.app,
        tags: parseTags(r.tags),
      })).sort((a, b) => a.action.localeCompare(b.action));

      const newData = newRows.map(r => ({
        name: r.name,
        icon: r.icon,
        secondary: r.secondary,
        action: r.action,
        app: r.app,
        tags: r.tags,
      })).sort((a, b) => a.action.localeCompare(b.action));

      if (JSON.stringify(existingData) === JSON.stringify(newData)) {
        continue;
      }

      // Replace all for this source
      for (const r of existingRecords) await pb.collection("searchItems").delete(r.id).catch(() => {});
      for (const row of newRows) {
        await pb.collection("searchItems").create({
          user: userId,
          name: row.name,
          icon: row.icon,
          secondary: row.secondary,
          action: row.action,
          app: row.app || null,
          tags: JSON.stringify(row.tags ?? []),
          sourceId: sid,
          sourceUpdated: row.sourceUpdated,
        });
      }
    }
  }
}

function serializeShortcutAction(action: unknown): string {
  if (typeof action === "string") {
    return action.trim();
  }
  if (action && typeof action === "object") {
    try {
      return JSON.stringify(action);
    } catch {
      return "";
    }
  }
  return "";
}