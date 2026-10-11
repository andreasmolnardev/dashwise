import type { RecordModel } from "pocketbase";
import { createHash, randomBytes, randomUUID } from "node:crypto";

import { getSuperuserPB } from "../pb/pocketbase";
import { ApiActionError } from "./auth";
import { revokeSessionConnections, revokeUserConnections } from "../session-connections";

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

export type PublicSession = Omit<SessionRecord, "tokenHash" | "pocketbaseToken">;

export function toPublicSession(session: SessionRecord): PublicSession {
  return {
    id: session.id, user: session.user, sessionId: session.sessionId,
    expiresAt: session.expiresAt, revokedAt: session.revokedAt,
    displayName: session.displayName, clientType: session.clientType,
    platform: session.platform, lastSeenAt: session.lastSeenAt,
    created: session.created, updated: session.updated,
  };
}

export async function isSessionActive(userId: string, sessionId: string) {
  const session = await getSessionById(await getSuperuserPB(), userId, sessionId);
  const now = Date.now();
  return !!session && !session.revokedAt && !!session.pocketbaseToken
    && Number.isFinite(Date.parse(session.expiresAt)) && Date.parse(session.expiresAt) > now
    && Number.isFinite(Date.parse(session.lastSeenAt))
    && Date.parse(session.lastSeenAt) + 30 * 24 * 60 * 60 * 1000 > now;
}

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

  const collection = (await getSuperuserPB()).collection("sessions");
  const session = await getSessionById({ collection: () => collection }, userId, sessionId);
  if (!session || session.revokedAt) return null;
  return toSessionRecord(await collection.update(session.id, {
    lastSeenAt: new Date().toISOString(),
    ...normalizeMetadata(metadata),
  }));
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
  return toPublicSession(session);
}

export async function listSessions(userId: string) {
  return (await (await getSuperuserPB()).collection("sessions").getFullList({
    filter: `user = "${escapeFilter(userId)}"`,
    sort: "-lastSeenAt",
  })).map((record) => toPublicSession(toSessionRecord(record)));
}

export async function revokeSession(userId: string, rawSessionId: unknown) {
  const session = await getSessionById(await getSuperuserPB(), userId, rawSessionId);
  if (!session) throw new ApiActionError("Session not found", 404, { error: "Session not found" });
  await (await getSuperuserPB()).collection("sessions").delete(session.id);
  revokeSessionConnections(userId, session.sessionId);
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

  return toPublicSession(toSessionRecord(await (await getSuperuserPB()).collection("sessions").update(session.id, {
    displayName: normalizedName,
    lastSeenAt: new Date().toISOString(),
  })));
}

// Keep revocation on the record so authentication already in flight cannot
// register a socket after the in-memory connections have been closed.
export async function revokeUserSessions(userId: string) {
  try {
    const collection = (await getSuperuserPB()).collection("sessions");
    const sessions = await collection.getFullList({
      filter: `user = "${escapeFilter(userId)}"`,
    });
    const revokedAt = new Date().toISOString();
    await Promise.all(sessions.map((session) => collection.update(session.id, { revokedAt })));
  } finally {
    revokeUserConnections(userId);
  }
}
