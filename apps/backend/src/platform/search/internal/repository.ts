import { getSuperuserPB } from "../../../lib/pb/pocketbase";
import type { SearchItemsResponse } from "@dashwise/types";

function parseTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry ?? "").trim())
      .filter((entry): entry is string => entry.length > 0);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .map((entry) => String(entry ?? "").trim())
          .filter((entry): entry is string => entry.length > 0);
      }
    } catch {
      return [trimmed];
    }
  }

  return [];
}

export async function getSearchItems(userId: string) {
  const pb = await getSuperuserPB();
  const records = (await pb.collection("searchItems").getFullList(1000, {
    filter: `user=\"${userId.replace(/"/g, '\\"')}\"`,
    sort: "name",
  })) as Array<SearchItemsResponse>;

  return records.map((record) => {
    const action = parseAction(record.action);
    const actionString = typeof action === "string" ? action : "";
    return {
      id: record.id,
      parentId:
        typeof record.app === "string" && record.app.trim().length > 0
          ? record.app.trim()
          : undefined,
      name: String(record.name ?? ""),
      icon: String(record.icon ?? ""),
      secondaryInfo: String(record.secondary ?? ""),
      type: actionString.startsWith("app:") ? "app" : "link",
      action,
      tags: parseTags(record.tags),
      isPinned: Boolean(record.isPinned),
      usageStats: record.usageStats,
    };
  });
}

type SearchItemAction = string | {
  type: string;
  url?: string;
  proxy?: boolean;
};

function parseAction(raw: unknown): SearchItemAction {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";

  if (trimmed.toLowerCase().startsWith("post:")) {
    const url = trimmed.slice(5).trim();
    return { type: "post", url, proxy: true };
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const type = String((parsed as any).type ?? "").trim().toLowerCase();
        if (type) {
          const url = typeof (parsed as any).url === "string" ? (parsed as any).url : undefined;
          if (type === "post") {
            return { type: "post", url, proxy: true };
          }
          return { type, url };
        }
      }
    } catch {
    }
  }

  return trimmed;
}

export type SearchItemRow = {
  name: string;
  icon: string;
  secondary: string;
  action: string;
  app: string;
  tags: string[];
  sourceId?: string;
  sourceUpdated?: string;
};

export async function recordSearchItemUsage(userId: string, id: string, timestamp: string) {
  const pb = await getSuperuserPB();
  const record = await pb.collection("searchItems").getOne(id);
  if (record.user !== userId) return false;

  const usageStats = Array.isArray(record.usageStats) ? record.usageStats : [];
  usageStats.push({ timestamp });
  if (usageStats.length > 100) usageStats.shift();
  await pb.collection("searchItems").update(id, { usageStats });
  return true;
}

export async function getFrequentlyUsedSearchItems(userId: string) {
  const pb = await getSuperuserPB();
  const records = await pb.collection("searchItems").getFullList(1000, {
    filter: `user="${userId.replace(/"/g, '\\"')}"`,
  });

  return records
    .map((record) => ({
      id: record.id,
      usageCount: Array.isArray(record.usageStats) ? record.usageStats.length : 0,
    }))
    .filter((record) => record.usageCount > 0)
    .sort((a, b) => b.usageCount - a.usageCount)
    .slice(0, 5)
    .map((record) => ({ id: record.id }));
}

export async function rebuildUserSearchItems(userId: string, rows: SearchItemRow[]) {
  const pb = await getSuperuserPB();
  const existing = await pb.collection("searchItems").getFullList(1000, {
    filter: `user="${userId.replace(/"/g, '\\"')}"`,
  });
  const existingBySource = new Map<string, any[]>();
  for (const record of existing) {
    const sourceId = record.sourceId || "legacy";
    const records = existingBySource.get(sourceId) ?? [];
    records.push(record);
    existingBySource.set(sourceId, records);
  }
  const newBySource = new Map<string, SearchItemRow[]>();
  for (const row of rows) {
    const sourceId = row.sourceId || "unknown";
    const sourceRows = newBySource.get(sourceId) ?? [];
    sourceRows.push(row);
    newBySource.set(sourceId, sourceRows);
  }

  for (const [sourceId, records] of existingBySource) {
    if (sourceId === "legacy" || !newBySource.has(sourceId)) {
      for (const record of records) await pb.collection("searchItems").delete(record.id).catch(() => {});
    }
  }
  for (const [sourceId, newRows] of newBySource) {
    const existingRecords = existingBySource.get(sourceId) ?? [];
    const isLink = newRows.length === 1 && newRows[0].app === "" && newRows[0].action.startsWith("url:");
    if (isLink) {
      const newRow = newRows[0];
      const existingRecord = existingRecords[0];
      if (existingRecord) {
        if (new Date(newRow.sourceUpdated || 0).getTime() <= new Date(existingRecord.updated).getTime()) continue;
        await pb.collection("searchItems").delete(existingRecord.id).catch(() => {});
      }
      await createSearchItem(pb, userId, sourceId, newRow);
      continue;
    }
    const existingData = existingRecords.map(searchItemData).sort(sortByAction);
    const newData = newRows.map(searchItemData).sort(sortByAction);
    if (JSON.stringify(existingData) === JSON.stringify(newData)) continue;
    for (const record of existingRecords) await pb.collection("searchItems").delete(record.id).catch(() => {});
    for (const row of newRows) await createSearchItem(pb, userId, sourceId, row);
  }
}

function createSearchItem(pb: any, userId: string, sourceId: string, row: SearchItemRow) {
  return pb.collection("searchItems").create({
    user: userId,
    name: row.name,
    icon: row.icon,
    secondary: row.secondary,
    action: row.action,
    app: row.app || null,
    tags: JSON.stringify(row.tags ?? []),
    sourceId,
    sourceUpdated: row.sourceUpdated,
  });
}

function searchItemData(row: any) {
  return {
    name: row.name,
    icon: row.icon,
    secondary: row.secondary,
    action: row.action,
    app: row.app,
    tags: parseIndexedTags(row.tags),
  };
}

function sortByAction(a: { action: string }, b: { action: string }) {
  return a.action.localeCompare(b.action);
}

function parseIndexedTags(value: unknown) {
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
