import { randomUUID } from "node:crypto";

import { ApiActionError } from "./auth";
import {
  isSessionConnected,
  requestShortcutExecution,
  type ShortcutExecutionResult,
} from "../activity";
import { getSessionById } from "./sessions";
import { getSuperuserPB } from "../pb/pocketbase";
import type { ShortcutsResponse } from "@dashwise/types";

export type ShortcutAppType = "just-in-time" | "on-demand";

export type ShortcutAppDetails = {
  name: string;
  icon?: string;
};

export type OnDemandShortcutInput = {
  sourceId: string;
  name: string;
  icon?: string;
  secondary?: string;
  action: string;
  tags?: string[];
};

export type RoutedShortcutAction = {
  sessionId: string;
  shortcutId: string;
};

export function escapeFilter(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function parseTags(value: unknown): string[] {
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

export function parseRoutedShortcutAction(value: unknown): RoutedShortcutAction | null {
  if (typeof value !== "string") return null;
  const match = /^shortcut:([^\.]+)\.(.+)$/i.exec(value.trim());
  if (!match) return null;

  const sessionId = match[1].trim();
  const shortcutId = match[2].trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(sessionId)) return null;
  if (!shortcutId || shortcutId.length > 512 || hasControlCharacter(shortcutId)) return null;
  return { sessionId, shortcutId };
}

function hasControlCharacter(value: string) {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

export async function executeRoutedShortcut(userId: string, action: unknown) {
  const target = parseRoutedShortcutAction(action);
  if (!target) {
    throw new ApiActionError("Invalid shortcut action", 400, {
      error: "Invalid shortcut action",
    });
  }

  const pb = await getSuperuserPB();
  const session = await getSessionById(pb, userId, target.sessionId);
  if (!session) {
    throw new ApiActionError("Target session is unavailable", 404, {
      error: "Target session is unavailable",
    });
  }
  if (!isSessionConnected(userId, target.sessionId)) {
    throw new ApiActionError("Target session is offline", 503, {
      error: "Target session is offline",
    });
  }

  const result: ShortcutExecutionResult = await requestShortcutExecution(
    userId,
    target.sessionId,
    target.shortcutId,
  );
  if (!result.success) {
    throw new ApiActionError(result.error ?? "Shortcut execution failed", 502, {
      error: result.error ?? "Shortcut execution failed",
      requestId: result.requestId,
    });
  }

  return result;
}

export async function getShortcuts(userId: string) {
  const pb = await getSuperuserPB();
  const records = (await pb.collection("shortcuts").getFullList(1000, {
    filter: `user="${escapeFilter(userId)}"`,
    sort: "name",
  })) as Array<ShortcutsResponse>;

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

export async function ensureShortcutsApp(
  pb: any,
  userId: string,
  sourceId: string,
  details: ShortcutAppDetails,
  type: ShortcutAppType = "just-in-time",
) {
  const filter = `user="${escapeFilter(userId)}" && sourceId="${escapeFilter(sourceId)}"`;
  const records = await pb.collection("shortcutsApps").getFullList(10, {
    filter,
    sort: "created",
  });
  const existing = records[0];
  if (existing) {
    const updates: Record<string, string> = {};
    if (details.name && existing.name !== details.name) updates.name = details.name;
    if (details.icon !== undefined && existing.icon !== details.icon) updates.icon = details.icon;
    if (Object.keys(updates).length > 0) {
      return pb.collection("shortcutsApps").update(existing.id, updates);
    }
    return existing;
  }

  return pb.collection("shortcutsApps").create({
    user: userId,
    sourceId,
    name: details.name,
    type,
    icon: details.icon ?? "",
  });
}

export async function getOnDemandShortcutApp(userId: string, appId: string) {
  const pb = await getSuperuserPB();
  let appRecord: any;
  try {
    appRecord = await pb.collection("shortcutsApps").getOne(appId);
  } catch {
    throw new ApiActionError("Shortcut app not found", 404, {
      error: "Shortcut app not found",
    });
  }

  if (String(appRecord.user ?? "") !== userId) {
    throw new ApiActionError("Shortcut app not found", 404, {
      error: "Shortcut app not found",
    });
  }
  if (appRecord.type !== "on-demand") {
    throw new ApiActionError("Shortcut app is not on-demand", 409, {
      error: "Shortcut app is not on-demand",
    });
  }

  return { pb, appRecord };
}

export async function createOnDemandShortcutApp(
  userId: string,
  input: { name?: unknown; type?: unknown; icon?: unknown },
) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) {
    throw new ApiActionError("A shortcut app name is required", 400, {
      error: "A shortcut app name is required",
    });
  }
  if (input.type !== "on-demand") {
    throw new ApiActionError("Only on-demand shortcut apps can be created here", 400, {
      error: "type must be on-demand",
    });
  }

  const icon = typeof input.icon === "string" ? input.icon.trim() : "";
  const sourceId = `on-demand:${randomUUID()}`;
  const pb = await getSuperuserPB();
  const record = await pb.collection("shortcutsApps").create({
    user: userId,
    sourceId,
    name,
    type: "on-demand",
    icon,
  });
  await pb.collection("shortcuts").create({
    user: userId,
    name,
    icon,
    secondary: "Shortcut app",
    action: `app:${record.id}`,
    app: null,
    sourceId: `shortcuts-app:${record.id}`,
    tags: [name, "shortcut app"],
  });

  return {
    appId: record.id,
    id: record.id,
    name: record.name,
    type: record.type,
  };
}

export async function syncOnDemandShortcuts(
  userId: string,
  appId: string,
  rawShortcuts: unknown,
) {
  if (!Array.isArray(rawShortcuts)) {
    throw new ApiActionError("shortcuts must be an array", 400, {
      error: "shortcuts must be an array",
    });
  }

  const { pb } = await getOnDemandShortcutApp(userId, appId);
  const shortcuts = rawShortcuts.map(normalizeOnDemandShortcut);
  const sourceIds = new Set<string>();
  for (const shortcut of shortcuts) {
    if (sourceIds.has(shortcut.sourceId)) {
      throw new ApiActionError("Shortcut sourceId values must be unique", 400, {
        error: `Duplicate shortcut sourceId: ${shortcut.sourceId}`,
      });
    }
    sourceIds.add(shortcut.sourceId);
  }

  const filter = `user="${escapeFilter(userId)}" && app="${escapeFilter(appId)}"`;
  const existing = await pb.collection("shortcuts").getFullList(10000, {
    filter,
  });
  const existingBySourceId = new Map<string, any>();
  for (const record of existing) {
    const sourceId = String(record.sourceId ?? "");
    if (sourceId) {
      existingBySourceId.set(sourceId, record);
    } else {
      await pb.collection("shortcuts").delete(record.id);
    }
  }

  let created = 0;
  let updated = 0;
  for (const shortcut of shortcuts) {
    const current = existingBySourceId.get(shortcut.sourceId);
    const data = {
      user: userId,
      app: appId,
      sourceId: shortcut.sourceId,
      name: shortcut.name,
      icon: shortcut.icon,
      secondary: shortcut.secondary,
      action: shortcut.action,
      tags: shortcut.tags,
    };

    if (!current) {
      await pb.collection("shortcuts").create(data);
      created += 1;
      continue;
    }

    if (!sameShortcutData(current, shortcut)) {
      await pb.collection("shortcuts").update(current.id, {
        name: data.name,
        icon: data.icon,
        secondary: data.secondary,
        action: data.action,
        tags: data.tags,
      });
      updated += 1;
    }
    existingBySourceId.delete(shortcut.sourceId);
  }

  let deleted = 0;
  for (const record of existingBySourceId.values()) {
    await pb.collection("shortcuts").delete(record.id);
    deleted += 1;
  }

  return { appId, total: shortcuts.length, created, updated, deleted };
}

function normalizeOnDemandShortcut(raw: unknown): Required<OnDemandShortcutInput> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ApiActionError("Each shortcut must be an object", 400, {
      error: "Each shortcut must be an object",
    });
  }

  const input = raw as Record<string, unknown>;
  const sourceId = stringInput(input.sourceId);
  const name = stringInput(input.name);
  const action = stringInput(input.action);
  if (!sourceId || !name || !action) {
    throw new ApiActionError("Each shortcut requires sourceId, name, and action", 400, {
      error: "Each shortcut requires sourceId, name, and action",
    });
  }

  const tags = input.tags === undefined ? [] : parseTags(input.tags);
  if (input.tags !== undefined && !Array.isArray(input.tags) && typeof input.tags !== "string") {
    throw new ApiActionError("Shortcut tags must be an array", 400, {
      error: "Shortcut tags must be an array",
    });
  }

  return {
    sourceId,
    name,
    icon: stringInput(input.icon),
    secondary: stringInput(input.secondary),
    action,
    tags,
  };
}

function stringInput(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function sameShortcutData(record: any, shortcut: Required<OnDemandShortcutInput>) {
  return String(record.name ?? "") === shortcut.name &&
    String(record.icon ?? "") === shortcut.icon &&
    String(record.secondary ?? "") === shortcut.secondary &&
    String(record.action ?? "") === shortcut.action &&
    JSON.stringify(parseTags(record.tags)) === JSON.stringify(shortcut.tags);
}

type ShortcutAction = string | {
  type: string;
  url?: string;
  proxy?: boolean;
};

function parseAction(raw: unknown): ShortcutAction {
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
      // Keep malformed action JSON as a literal string.
    }
  }

  return trimmed;
}
