import { getSuperuserPB } from "../pb/pocketbase";
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
