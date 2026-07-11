import { getPageConfigJSON, getUserPages, updatePageConfig } from "../../lib/data/pageConfig";

const FRONTEND_ONLY_WIDGETS = new Set([
  "placeholder",
  "main-clock",
  "glanceable-clock",
  "search-bar",
  "link-view",
]);

const FRONTEND_ONLY_GLANCEABLES = new Set([
  "date",
  "greeting",
  "local-timezone",
  "world-clock",
]);

export async function prunePageConfigConsumersForIntegration(
  userId: string,
  integrationId: string,
  integrationConfig: Record<string, any>,
) {
  const match = buildConsumerMatch(integrationId, integrationConfig);
  const pages = await getUserPages(userId).catch(() => []);

  for (const page of pages) {
    const pageName = page?.pageName;
    if (!pageName) continue;

    const config = await getPageConfigJSON(userId, pageName);
    if (!config || typeof config !== "object") continue;

    const nextConfig = pruneConsumersForIntegration(config as Record<string, any>, match);
    if (JSON.stringify(nextConfig) !== JSON.stringify(config)) {
      await updatePageConfig(userId, pageName, nextConfig as any);
    }
  }
}

function pruneConsumersForIntegration(config: Record<string, any>, match: ConsumerMatch) {
  const nextConfig = { ...config };

  if (isPlainObject(nextConfig.columns)) {
    const nextColumns: Record<string, Record<string, any>> = {};

    for (const [columnName, columnValue] of Object.entries(nextConfig.columns as Record<string, unknown>)) {
      if (!isPlainObject(columnValue)) {
        nextColumns[columnName] = columnValue as Record<string, any>;
        continue;
      }

      const nextColumn: Record<string, any> = {};
      for (const [widgetKey, widgetConfig] of Object.entries(columnValue as Record<string, unknown>)) {
        if (!widgetConfig || typeof widgetConfig !== "object") {
          nextColumn[widgetKey] = widgetConfig;
          continue;
        }

        if (FRONTEND_ONLY_WIDGETS.has(widgetKey)) {
          if (widgetKey === "main-clock") {
            const nextWidget = pruneClockGlanceables(widgetConfig as Record<string, any>, match);
            if (nextWidget) {
              nextColumn[widgetKey] = nextWidget;
            }
          } else {
            nextColumn[widgetKey] = widgetConfig;
          }
          continue;
        }

        if (matchesConsumerKey(widgetKey, match.widgetKeys, match.integrationId)) {
          continue;
        }

        nextColumn[widgetKey] = widgetConfig;
      }

      nextColumns[columnName] = nextColumn;
    }

    nextConfig.columns = nextColumns;
  }

  if (Array.isArray(nextConfig.glanceables)) {
    const nextGlanceables: unknown[] = [];
    for (const entry of nextConfig.glanceables) {
      if (!isPlainObject(entry)) continue;
      const type = typeof entry.type === "string" ? entry.type.trim() : "";
      if (!type) continue;

      if (FRONTEND_ONLY_GLANCEABLES.has(type)) {
        nextGlanceables.push(entry);
        continue;
      }

      if (matchesConsumerKey(type, match.glanceableKeys, match.integrationId)) {
        continue;
      }

      nextGlanceables.push(entry);
    }

    nextConfig.glanceables = nextGlanceables;
  }

  return nextConfig;
}

function pruneClockGlanceables(widgetConfig: Record<string, any>, match: ConsumerMatch) {
  if (!isPlainObject(widgetConfig.glanceables)) {
    return widgetConfig;
  }

  const slots = widgetConfig.glanceables.slots;
  if (isPlainObject(slots)) {
    const nextSlots: Record<string, unknown> = {};
    for (const [side, entries] of Object.entries(slots)) {
      nextSlots[side] = Array.isArray(entries)
        ? entries.filter((entry) => {
            if (!isPlainObject(entry)) return true;
            const type = typeof entry.type === "string" ? entry.type.trim() : "";
            return !type || FRONTEND_ONLY_GLANCEABLES.has(type) || !matchesConsumerKey(type, match.glanceableKeys, match.integrationId);
          })
        : entries;
    }

    return {
      ...widgetConfig,
      glanceables: {
        ...widgetConfig.glanceables,
        slots: nextSlots,
      },
    };
  }

  const nextGlanceables: Record<string, any> = {};
  for (const [key, value] of Object.entries(widgetConfig.glanceables as Record<string, unknown>)) {
    const glanceableType = String(key ?? "").trim();
    if (!glanceableType) continue;

    if (FRONTEND_ONLY_GLANCEABLES.has(glanceableType)) {
      nextGlanceables[glanceableType] = value;
      continue;
    }

    if (matchesConsumerKey(glanceableType, match.glanceableKeys, match.integrationId)) {
      continue;
    }

    nextGlanceables[glanceableType] = value;
  }

  return {
    ...widgetConfig,
    glanceables: nextGlanceables,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type ConsumerMatch = {
  integrationId: string;
  widgetKeys: Set<string>;
  glanceableKeys: Set<string>;
};

function buildConsumerMatch(integrationId: string, integrationConfig: Record<string, any>): ConsumerMatch {
  const configuration = isPlainObject(integrationConfig?.configuration)
    ? integrationConfig.configuration as Record<string, any>
    : {};

  return {
    integrationId,
    widgetKeys: collectConsumerKeys(configuration.widgets, resolveWidgetKey),
    glanceableKeys: collectConsumerKeys(configuration.glanceables, resolveGlanceableKey),
  };
}

function collectConsumerKeys(items: unknown, resolve: (item: Record<string, unknown>) => string | null) {
  const keys = new Set<string>();
  if (!Array.isArray(items)) return keys;

  for (const item of items) {
    if (!isPlainObject(item)) continue;
    const key = resolve(item);
    if (key) keys.add(key);
  }

  return keys;
}

function matchesConsumerKey(key: string, deletedKeys: Set<string>, integrationId: string) {
  const trimmed = key.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith(`${integrationId}#`)) return true;
  const normalized = normalizeConsumerKey(trimmed);
  return normalized ? deletedKeys.has(normalized) : false;
}

function resolveWidgetKey(item: Record<string, unknown>) {
  const key = typeof item.key === "string" && item.key.trim() ? item.key.trim() : null;
  const slug = typeof item.slug === "string" && item.slug.trim() ? item.slug.trim() : null;
  return normalizeConsumerKey(key ?? slug ?? "") || resolveNameKey(item.name);
}

function resolveGlanceableKey(item: Record<string, unknown>) {
  const key = typeof item.key === "string" && item.key.trim() ? item.key.trim() : null;
  const type = typeof item.type === "string" && item.type.trim() ? item.type.trim() : null;
  const slug = typeof item.slug === "string" && item.slug.trim() ? item.slug.trim() : null;
  return normalizeConsumerKey(key ?? type ?? slug ?? "") || resolveNameKey(item.name ?? item.displayName);
}

function resolveNameKey(value: unknown) {
  return typeof value === "string"
    ? normalizeConsumerKey(value.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""))
    : null;
}

function normalizeConsumerKey(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "day-progress" || normalized === "week-progress" || normalized === "month-progress" || normalized === "year-progress") {
    return "progress";
  }
  return normalized || null;
}
