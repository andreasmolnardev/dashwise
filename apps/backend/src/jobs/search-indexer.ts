import { resolveEndpointCatalog } from "@dashwise/integrationskit/data/getEndpointData";
import {
  flattenToEnv,
  getNestedValue,
  resolveComputedFieldValue,
  resolveComputedFields,
} from "@dashwise/integrationskit/data/getComputedField";
import { getHomeLinks } from "@dashwise/sdk/data/links";
import { getSuperuserPB } from "@dashwise/sdk/lib/pocketbase";
import { config } from "../config/env";

type IntegrationRecord = {
  id: string;
  name?: string | null;
  source?: string | null;
  config?: unknown;
  environment?: unknown;
};

type SearchItemRow = {
  name: string;
  icon: string;
  secondary: string;
  action: string;
  app: string;
  tags: string[];
};

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

function decodeMaybeBase64(value: string | undefined | null) {
  if (!value) return "";
  try {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    if (decoded && /[\x20-\x7E]/.test(decoded)) {
      return decoded;
    }
    return value;
  } catch {
    return value;
  }
}

function resolveEnvironmentVariables(integrationConfig: Record<string, any>, rawEnvironment: unknown) {
  const envDefinitions =
    integrationConfig?.configuration?.environment_variables &&
    typeof integrationConfig.configuration.environment_variables === "object"
      ? (integrationConfig.configuration.environment_variables as Record<string, any>)
      : {};
  const encoded = normalizeObject(rawEnvironment);

  const resolved: Record<string, string> = {};
  for (const [name, definition] of Object.entries(envDefinitions)) {
    const current = encoded[name];
    if (current !== undefined && current !== null && String(current).trim() !== "") {
      resolved[name] = decodeMaybeBase64(String(current));
      continue;
    }
    if (definition && typeof definition === "object" && "default" in definition) {
      resolved[name] = String((definition as Record<string, any>).default ?? "");
      continue;
    }
    resolved[name] = "";
  }

  for (const [name, value] of Object.entries(encoded)) {
    if (value === undefined || value === null) continue;
    resolved[name] = decodeMaybeBase64(String(value));
  }

  return resolved;
}

function normalizeKey(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}

function isIntegrationEnabled(
  integration: IntegrationRecord,
  integrationConfig: Record<string, any>,
  enabledMap: Record<string, boolean>,
) {
  if (Object.keys(enabledMap).length === 0) {
    return true;
  }

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

function resolvePathValue(root: Record<string, any>, current: unknown, rawPath: string, index = 0): unknown {
  const path = rawPath.trim().replace(/^this\./, "");
  if (!path) return "";
  if (path === "_index") return index;

  const currentValue =
    current && typeof current === "object"
      ? getNestedValue(current as Record<string, any>, path)
      : undefined;
  if (currentValue !== undefined && currentValue !== null) {
    return currentValue;
  }

  const rootValue = getNestedValue(root, path);
  if (rootValue !== undefined && rootValue !== null) {
    return rootValue;
  }

  return undefined;
}

function resolveSearchString(root: Record<string, any>, current: unknown, template: string, index = 0) {
  const interpolated = template.replace(/\$\{([^}]+)\}/g, (_, expr) => {
    const value = resolvePathValue(root, current, String(expr), index);
    return value === undefined || value === null ? "" : String(value);
  });

  const trimmed = interpolated.trim();
  if (!trimmed) return "";

  const direct = resolvePathValue(root, current, trimmed, index);
  return direct !== undefined ? direct : trimmed;
}

function resolveSearchNode(root: Record<string, any>, current: unknown, node: unknown, index = 0): unknown {
  if (node === undefined || node === null) return node;
  if (typeof node === "string") return resolveSearchString(root, current, node, index);
  if (typeof node === "number" || typeof node === "boolean") return node;

  if (Array.isArray(node)) {
    const merged: Record<string, any> = {};
    for (const entry of node) {
      const resolved = resolveSearchNode(root, current, entry, index);
      if (resolved && typeof resolved === "object" && !Array.isArray(resolved)) {
        Object.assign(merged, resolved as Record<string, any>);
      }
    }
    return merged;
  }

  if (typeof node !== "object") return node;
  const objectNode = node as Record<string, any>;

  if (typeof objectNode.operation === "string") {
    const scopeRoot = {
      ...root,
      current,
      item: current,
    };
    const env = {
      ...flattenToEnv(root),
      ...(current && typeof current === "object" ? flattenToEnv(current as Record<string, any>) : {}),
      _index: String(index),
    };
    return resolveComputedFieldValue(objectNode, {
      env,
      scope: scopeRoot,
      current: current && typeof current === "object" ? (current as Record<string, any>) : undefined,
      currentKey: String(index),
    });
  }

  if (
    typeof objectNode.iterate === "string" ||
    typeof objectNode.iterate_over === "string"
  ) {
    const iteratePath = typeof objectNode.iterate === "string"
      ? objectNode.iterate
      : objectNode.iterate_over;
    const source = resolvePathValue(root, current, String(iteratePath), index);
    const entries = Array.isArray(source)
      ? source
      : source && typeof source === "object"
      ? Object.values(source as Record<string, any>)
      : [];

    const mappingShape =
      objectNode.mappingProperties && typeof objectNode.mappingProperties === "object"
        ? objectNode.mappingProperties
        : objectNode;

    return entries.map((entry, itemIndex) => {
      const mapped: Record<string, any> = {};
      for (const [key, value] of Object.entries(mappingShape)) {
        if (["iterate", "iterate_over", "mappingProperties"].includes(key)) continue;
        mapped[key] = resolveSearchNode(root, entry, value, itemIndex);
      }
      return mapped;
    });
  }

  const output: Record<string, any> = {};
  for (const [key, value] of Object.entries(objectNode)) {
    output[key] = resolveSearchNode(root, current, value, index);
  }
  return output;
}

function toTagList(raw: unknown) {
  if (Array.isArray(raw)) {
    return raw
      .map((entry) => String(entry ?? "").trim())
      .filter((entry): entry is string => entry.length > 0);
  }
  if (raw === undefined || raw === null) return [] as string[];
  const asString = String(raw).trim();
  return asString ? [asString] : [];
}

async function getEnabledIntegrationsMap(pb: any, userId: string) {
  const pageConfigs = await pb
    .collection("pageConfig")
    .getFullList(200, {
      filter: `associatedUserId=\"${escapeFilter(userId)}\"`,
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

function uniqueRows(rows: SearchItemRow[]) {
  const seen = new Set<string>();
  const result: SearchItemRow[] = [];

  for (const row of rows) {
    const key = `${row.app}::${row.action}::${row.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(row);
  }

  return result;
}

async function buildIntegrationSearchRows(integration: IntegrationRecord): Promise<SearchItemRow[]> {
  const integrationConfig = normalizeObject(integration.config);
  const searchDefinitions = Array.isArray(integrationConfig?.search_items)
    ? (integrationConfig.search_items as Array<Record<string, any>>)
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

  const env = resolveEnvironmentVariables(integrationConfig, integration.environment);
  const endpointResult = await resolveEndpointCatalog(
    integrationConfig?.configuration?.endpoints,
    {
      env,
      scope: {},
    },
    config.ALLOW_SSL,
  );

  const computed = resolveComputedFields(integrationConfig?.configuration?.computed, {
    env: endpointResult.env,
    scope: {
      endpoints: endpointResult.endpoints,
      lookup_tables: integrationConfig?.configuration?.lookup_tables,
    },
  });

  const root = {
    endpoints: endpointResult.endpoints,
    computed,
    lookup_tables: integrationConfig?.configuration?.lookup_tables,
  };

  const appId = `integration:${integration.id}`;
  const rows: SearchItemRow[] = [];

  for (const definition of searchDefinitions) {
    if (!definition || typeof definition !== "object") continue;
    for (const sectionValue of Object.values(definition as Record<string, any>)) {
      const resolved = resolveSearchNode(root, root, sectionValue);
      const candidates = Array.isArray(resolved)
        ? resolved
        : resolved && typeof resolved === "object"
        ? Object.values(resolved as Record<string, any>)
        : [];

      for (const candidate of candidates) {
        if (!candidate || typeof candidate !== "object") continue;
        const item = candidate as Record<string, any>;
        const name = String(item.name ?? "").trim();
        const action = String(item.action ?? "").trim();
        if (!name || !action) continue;

        rows.push({
          name,
          icon: String(item.icon ?? integrationIcon),
          secondary: String(item.secondaryInfo ?? item.secondary ?? integrationName),
          action,
          app: appId,
          tags: toTagList(item.tags),
        });
      }
    }
  }

  if (rows.length === 0) {
    return [];
  }

  return [
    {
      name: integrationName,
      icon: integrationIcon,
      secondary: "Integration",
      action: `app:${appId}`,
      app: "",
      tags: [integrationName, "integration"],
    },
    ...rows,
  ];
}

async function rebuildUserSearchItems(pb: any, userId: string, rows: SearchItemRow[]) {
  const existing = await pb.collection("searchItems").getFullList(1000, {
    filter: `user=\"${escapeFilter(userId)}\"`,
    fields: "id",
  });

  for (const record of existing) {
    await pb.collection("searchItems").delete(record.id);
  }

  const sortedRows = uniqueRows(rows).sort((left, right) => left.name.localeCompare(right.name));
  for (const row of sortedRows) {
    await pb.collection("searchItems").create({
      user: userId,
      name: row.name,
      icon: row.icon,
      secondary: row.secondary,
      action: row.action,
      app: row.app || null,
      tags: JSON.stringify(row.tags ?? []),
    });
  }
}

export async function runSearchItemsIndexing() {
  const pb = await getSuperuserPB();
  const users = await pb.collection("users").getFullList<{ id: string }>(500, {
    fields: "id",
  });

  for (const user of users) {
    const userId = user.id;
    if (!userId) continue;

    const rows: SearchItemRow[] = [];
    const links = await getHomeLinks(userId).catch(() => [] as any[]);
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
      });
    }

    const enabledIntegrations = await getEnabledIntegrationsMap(pb, userId);
    const integrations = await pb.collection("integrations").getFullList<IntegrationRecord>(500, {
      filter: `user=\"${escapeFilter(userId)}\"`,
      sort: "-updated",
    });

    for (const integration of integrations) {
      const integrationConfig = normalizeObject(integration.config);
      if (!isIntegrationEnabled(integration, integrationConfig, enabledIntegrations)) {
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
