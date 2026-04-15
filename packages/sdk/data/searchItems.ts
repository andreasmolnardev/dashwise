import { getSuperuserPB } from "@dashwise/sdk/lib/pocketbase";

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
  const records = await pb.collection("searchItems").getFullList(1000, {
    filter: `user=\"${userId.replace(/"/g, '\\"')}\"`,
    sort: "name",
  });

  return records.map((record) => {
    const action = String(record.action ?? "").trim();
    return {
      id: record.id,
      parentId:
        typeof record.app === "string" && record.app.trim().length > 0
          ? record.app.trim()
          : undefined,
      name: String(record.name ?? ""),
      icon: String(record.icon ?? ""),
      secondaryInfo: String(record.secondary ?? ""),
      type: action.startsWith("app:") ? "app" : "link",
      action,
      tags: parseTags(record.tags),
    };
  });
}
