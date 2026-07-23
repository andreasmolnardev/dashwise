import { defaultShortcutsManifest } from "@dashwise/assets";
import type { HomeLink } from "@dashwise/types";
import { getHomeLinks } from "../../../modules/links";
import { config } from "../../../lib/config";
import { getSuperuserPB } from "../../../lib/pb/pocketbase";
import { rebuildUserSearchItems, type SearchItemRow } from "./repository";

export { getFrequentlyUsedSearchItems, getSearchItems, recordSearchItemUsage } from "./repository";

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

    await rebuildUserSearchItems(userId, rows);
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
