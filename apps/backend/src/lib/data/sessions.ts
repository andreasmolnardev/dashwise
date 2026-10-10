import type { RecordModel } from "pocketbase";
import { createHash, randomBytes, randomUUID } from "node:crypto";

import { getSuperuserPB } from "../pb/pocketbase";
import { ApiActionError } from "./auth";

export type SessionRecord = {
  id: string;
  user: string;
  sessionId: string;
  tokenHash: string;
  pocketbaseToken?: string;
  expiresAt: string;
  revokedAt?: string;
  displayName: string;
  clientType?: string;
  platform?: string;
  lastSeenAt: string;
  created?: string;
  updated?: string;
};

type SessionMetadata = {
  clientType?: string;
  platform?: string;
};

const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const DEFAULT_DISPLAY_NAME = "Web browser";

export function normalizeSessionId(value: unknown) {
  const sessionId = typeof value === "string" ? value.trim() : "";
  return SESSION_ID_PATTERN.test(sessionId) ? sessionId : null;
}

export async function getSessionById(
  pb: { collection: (name: "sessions") => any },
  userId: string,
  rawSessionId: unknown,
) {
  const sessionId = normalizeSessionId(rawSessionId);
  if (!sessionId) return null;

  try {
    return toSessionRecord(await pb.collection("sessions").getFirstListItem(
      `user = "${escapeFilter(userId)}" && sessionId = "${escapeFilter(sessionId)}"`,
    ));
  } catch {
    return null;
  }
}

function normalizeMetadata(metadata?: SessionMetadata) {
  return {
    ...(metadata?.clientType?.trim() ? { clientType: metadata.clientType.trim().slice(0, 100) } : {}),
    ...(metadata?.platform?.trim() ? { platform: metadata.platform.trim().slice(0, 100) } : {}),
  };
}

function toSessionRecord(record: RecordModel) {
  return record as unknown as SessionRecord;
}

const SESSION_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  pb: { authStore?: { token?: string } },
  userId: string,
  metadata?: SessionMetadata,
) {
  const token = `dws_${randomBytes(32).toString("base64url")}`;
  const now = new Date();
  const sessionId = randomUUID().replace(/-/g, "");
  const record = await (await getSuperuserPB()).collection("sessions").create({
    user: userId,
    sessionId,
    tokenHash: hashSessionToken(token),
    pocketbaseToken: pb.authStore?.token ?? "",
    displayName: DEFAULT_DISPLAY_NAME,
    lastSeenAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_LIFETIME_MS).toISOString(),
    ...normalizeMetadata(metadata),
  });
  return { token, session: toSessionRecord(record) };
}

export async function ensureSession(
  userId: string,
  rawSessionId: unknown,
  metadata?: SessionMetadata,
) {
  const sessionId = normalizeSessionId(rawSessionId);
  if (!sessionId) return null;

  const now = new Date().toISOString();
  const collection = (await getSuperuserPB()).collection("sessions");
  const filter = `user = "${escapeFilter(userId)}" && sessionId = "${escapeFilter(sessionId)}"`;
  const normalizedMetadata = normalizeMetadata(metadata);

  let session: RecordModel | null = null;
  try {
    session = await collection.getFirstListItem(filter);
  } catch {
    // A missing record is created below. Other read errors are surfaced by create/update.
  }

  if (session) {
    return toSessionRecord(await collection.update(session.id, {
      lastSeenAt: now,
      ...normalizedMetadata,
    }));
  }

  try {
    return toSessionRecord(await collection.create({
      user: userId,
      sessionId,
      displayName: DEFAULT_DISPLAY_NAME,
      lastSeenAt: now,
      ...normalizedMetadata,
    }));
  } catch (error) {
    // Another request from the same client may have won the race to create the unique pair.
    try {
      const existing = await collection.getFirstListItem(filter);
      return toSessionRecord(await collection.update(existing.id, {
        lastSeenAt: now,
        ...normalizedMetadata,
      }));
    } catch {
      throw error;
    }
  }
}

function escapeFilter(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export async function getCurrentSession(
  userId: string,
  rawSessionId: unknown,
  metadata?: SessionMetadata,
) {
  const session = await ensureSession(userId, rawSessionId, metadata);
  if (!session) {
    throw new ApiActionError("A valid session id is required", 400, {
      error: "A valid session id is required",
    });
  }
  return session;
}

export async function listSessions(userId: string) {
  return (await (await getSuperuserPB()).collection("sessions").getFullList({
    filter: `user = "${escapeFilter(userId)}"`,
    sort: "-lastSeenAt",
  })).map(toSessionRecord);
}

export async function revokeSession(userId: string, rawSessionId: unknown) {
  const session = await getSessionById(await getSuperuserPB(), userId, rawSessionId);
  if (!session) throw new ApiActionError("Session not found", 404, { error: "Session not found" });
  await (await getSuperuserPB()).collection("sessions").delete(session.id);
  return { success: true };
}

export async function renameCurrentSession(
  userId: string,
  rawSessionId: unknown,
  displayName: unknown,
  metadata?: SessionMetadata,
) {
  const session = await getCurrentSession(userId, rawSessionId, metadata);
  const normalizedName = typeof displayName === "string" ? displayName.trim() : "";
  if (!normalizedName || normalizedName.length > 100) {
    throw new ApiActionError("Display name must be between 1 and 100 characters", 400, {
      error: "Display name must be between 1 and 100 characters",
    });
  }

  return toSessionRecord(await (await getSuperuserPB()).collection("sessions").update(session.id, {
    displayName: normalizedName,
    lastSeenAt: new Date().toISOString(),
  }));
}
