import { getIntegrationWithConsumer } from "@dashwise/sdk/data/integrations";
import { getPageConfigJSON, getUserPages, updatePageConfig } from "@dashwise/sdk/data/pageConfig";
import { getSuperuserPB } from "@dashwise/sdk/lib/pocketbase";

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

export async function runPageConfigCleanupJob() {
  const pb = await getSuperuserPB();
  const users = await pb.collection("users").getFullList({ sort: "-created" }).catch(() => []);

  for (const user of users) {
    if (!user?.id) continue;

    const pages = await getUserPages(user.id).catch(() => []);
    for (const page of pages) {
      const pageName = page?.pageName;
      if (!pageName) continue;

      const config = await getPageConfigJSON(user.id, pageName);
      if (!config || typeof config !== "object") continue;

      const nextConfig = await pruneOrphanedConsumers(user.id, config as Record<string, any>);
      if (JSON.stringify(nextConfig) !== JSON.stringify(config)) {
        await updatePageConfig(user.id, pageName, nextConfig as any);
      }
    }
  }
}

async function pruneOrphanedConsumers(userId: string, config: Record<string, any>) {
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
            const nextWidget = await pruneClockGlanceables(userId, widgetConfig as Record<string, any>);
            if (nextWidget) {
              nextColumn[widgetKey] = nextWidget;
            }
          } else {
            nextColumn[widgetKey] = widgetConfig;
          }
          continue;
        }

        const resolved = await getIntegrationWithConsumer(userId, { widgetKey }).catch(() => null);
        if (!resolved?.integrationId) {
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

      const resolved = await getIntegrationWithConsumer(userId, { glanceableType: type }).catch(() => null);
      if (!resolved?.integrationId) {
        continue;
      }

      nextGlanceables.push(entry);
    }

    nextConfig.glanceables = nextGlanceables;
  }

  return nextConfig;
}

async function pruneClockGlanceables(userId: string, widgetConfig: Record<string, any>) {
  if (!isPlainObject(widgetConfig.glanceables)) {
    return widgetConfig;
  }

  const nextGlanceables: Record<string, any> = {};
  for (const [key, value] of Object.entries(widgetConfig.glanceables as Record<string, unknown>)) {
    const glanceableType = String(key ?? "").trim();
    if (!glanceableType) continue;

    if (FRONTEND_ONLY_GLANCEABLES.has(glanceableType)) {
      nextGlanceables[glanceableType] = value;
      continue;
    }

    const resolved = await getIntegrationWithConsumer(userId, { glanceableType }).catch(() => null);
    if (!resolved?.integrationId) {
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
