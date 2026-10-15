import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import type { PlaybackEvent, PlaybackListenerContext } from "@dashwise/integrations-sdk";
import { ApiActionError } from "../lib/data/auth";
import { dispatchSdkPlaybackEvent, disposeSdkPlayback, fetchSdkPlaybackSource, resolveSdkPlayback } from "../lib/integrations-sdk/runtime";
import { readAuthToken, readJsonBody, requireAuth, withJson } from "./shared";

const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_SESSION_LIFETIME_MS = 24 * 60 * 60 * 1000;
const MAX_OPEN_SESSIONS_PER_USER = 12;
const CLOSED_RETENTION_MS = 5 * 60 * 1000;
const EVENT_TYPES = new Set<PlaybackEvent["type"]>(["started", "paused", "resumed", "progress", "ended", "stopped", "error"]);

type MediaSession = {
  id: string;
  userId: string;
  context: PlaybackListenerContext;
  capabilityHash: Buffer;
  createdAt: number;
  expiresAt: number;
  lastSequence: number;
  queue: Promise<void>;
  closing?: boolean;
  closedAt?: number;
};

type MediaDependencies = {
  authenticate(token: string | null): Promise<string>;
  resolve: typeof resolveSdkPlayback;
  dispatch: typeof dispatchSdkPlaybackEvent;
  dispose: typeof disposeSdkPlayback;
  fetchSource: typeof fetchSdkPlaybackSource;
};
type MediaRouteOptions = Partial<MediaDependencies> & {
  clock?: () => number;
  sessionTtlMs?: number;
  maxSessionLifetimeMs?: number;
  startCleanupTimer?: boolean;
};

export function createMediaRoute(options: MediaRouteOptions = {}) {
  const mediaRoute = new Hono();
  const mediaSessions = new Map<string, MediaSession>();
  const clock = options.clock ?? Date.now;
  const sessionTtlMs = options.sessionTtlMs ?? SESSION_TTL_MS;
  const maxSessionLifetimeMs = options.maxSessionLifetimeMs ?? MAX_SESSION_LIFETIME_MS;
  const dependencies: MediaDependencies = {
    async authenticate(token) {
      const { userId } = await requireAuth({ token });
      if (!userId) throw new ApiActionError("Unauthorized", 401, { error: "Unauthorized" });
      return userId;
    },
    resolve: resolveSdkPlayback,
    dispatch: dispatchSdkPlaybackEvent,
    dispose: disposeSdkPlayback,
    fetchSource: fetchSdkPlaybackSource,
    ...options,
  };

  mediaRoute.post("/api/v1/media/sessions", withJson(async (c) => {
    const userId = await dependencies.authenticate(readAuthToken(c));
    const body = await readJsonBody<Record<string, unknown>>(c);
    const resource = isRecord(body.resource) ? body.resource : {};
    const integrationInstanceId = requiredIdentity(resource.integrationInstanceId);
    const collectionId = requiredIdentity(resource.collectionId);
    const resourceId = requiredIdentity(resource.resourceId);
    if ([...mediaSessions.values()].filter((session) => session.userId === userId && !session.closedAt && !session.closing && session.expiresAt > clock()).length >= MAX_OPEN_SESSIONS_PER_USER) {
      throw new ApiActionError("Too many active playback sessions", 429, { error: "Too many active playback sessions" });
    }
    const id = randomUUID();
    const capability = randomBytes(32).toString("base64url");
    const resolved = await dependencies.resolve({ userId, integrationInstanceId, collectionId, resourceId, sessionId: id });
    const context = resolved.listenerContext;
    const now = clock();
    const session: MediaSession = {
      id, userId, context,
      capabilityHash: hashCapability(capability),
      createdAt: now,
      expiresAt: now + sessionTtlMs,
      lastSequence: -1,
      queue: Promise.resolve(),
    };
    mediaSessions.set(id, session);
    const proxyUrl = `/api/v1/media/streams/${encodeURIComponent(id)}?capability=${encodeURIComponent(capability)}`;
    const source = context.source;
    return {
      id,
      source: {
        url: proxyUrl,
        ...(source.metadata ? { metadata: source.metadata } : {}),
        ...(source.kind ? { kind: source.kind } : {}),
        ...(source.mimeType ? { mimeType: source.mimeType } : {}),
      },
    };
  }));

  mediaRoute.post("/api/v1/media/sessions/:id/events", withJson(async (c) => {
    const userId = await dependencies.authenticate(readAuthToken(c));
    const session = requireOwnedSession(String(c.req.param("id") ?? ""), userId);
    const body = await readJsonBody<Record<string, unknown>>(c);
    const event = parseEvent(body);
    let accepted = false;
    const run = session.queue.then(async () => {
      if (session.closedAt || session.closing || event.sequence <= session.lastSequence) return;
      try { await dependencies.dispatch(session.context, event); }
      catch { /* Listener failures must not interrupt media or prevent terminal cleanup. */ }
      session.lastSequence = event.sequence;
      renewSession(session);
      accepted = true;
      if (["ended", "stopped", "error"].includes(event.type)) await closeSession(session);
    });
    session.queue = run.catch(() => undefined);
    await run;
    return { accepted };
  }));

  mediaRoute.delete("/api/v1/media/sessions/:id", withJson(async (c) => {
    const userId = await dependencies.authenticate(readAuthToken(c));
    const session = requireOwnedSession(String(c.req.param("id") ?? ""), userId);
    session.closing = true;
    await session.queue;
    await closeSession(session);
    return { success: true };
  }));

  mediaRoute.on(["GET", "HEAD"], "/api/v1/media/streams/:id", async (c) => {
    const session = mediaSessions.get(c.req.param("id"));
    const capability = c.req.query("capability") ?? "";
    if (!session || session.closedAt || session.closing || session.expiresAt <= clock() || !matchesCapability(session, capability)) {
      if (session && !session.closedAt && !session.closing && session.expiresAt <= clock()) {
        session.closing = true;
        void session.queue.then(() => closeSession(session));
      }
      return c.json({ error: "Media session is unavailable" }, 404);
    }
    renewSession(session);
    try {
      const response = await dependencies.fetchSource(session.context, c.req.raw);
      const headers = new Headers({ "cache-control": "private, no-store", "x-content-type-options": "nosniff" });
      for (const name of ["accept-ranges", "content-length", "content-range", "content-type", "etag", "last-modified"]) {
        const value = response.headers.get(name);
        if (value) headers.set(name, value);
      }
      return new Response(c.req.method === "HEAD" ? null : response.body, {
        status: response.status,
        headers,
      });
    } catch (error) {
      if (error instanceof ApiActionError) return c.json(error.body ?? { error: error.message }, error.status as any);
      return c.json({ error: "Media source request failed" }, 502);
    }
  });

  function parseEvent(body: Record<string, unknown>): PlaybackEvent {
    const type = body.type;
    if (typeof type !== "string" || !EVENT_TYPES.has(type as PlaybackEvent["type"])) {
      throw new ApiActionError("Invalid playback event", 400, { error: "Invalid playback event" });
    }
    const sequence = body.sequence;
    if (!Number.isSafeInteger(sequence) || (sequence as number) < 0) {
      throw new ApiActionError("Invalid playback event sequence", 400, { error: "Invalid playback event sequence" });
    }
    const positionSeconds = body.positionSeconds;
    if (positionSeconds !== undefined && (typeof positionSeconds !== "number" || !Number.isFinite(positionSeconds) || positionSeconds < 0)) {
      throw new ApiActionError("Invalid playback position", 400, { error: "Invalid playback position" });
    }
    const reason = body.reason;
    if (reason !== undefined && (typeof reason !== "string" || reason.length > 120)) {
      throw new ApiActionError("Invalid playback event reason", 400, { error: "Invalid playback event reason" });
    }
    return {
      sequence: sequence as number,
      type: type as PlaybackEvent["type"],
      ...(positionSeconds !== undefined ? { positionSeconds } : {}),
      ...(reason !== undefined ? { reason } : {}),
    };
  }

  async function closeSession(session: MediaSession) {
    if (session.closedAt) return;
    session.closing = true;
    session.closedAt = clock();
    await dependencies.dispose(session.context).catch(() => undefined);
  }

  function requireOwnedSession(id: string, userId: string) {
    const session = mediaSessions.get(id);
    if (!session || session.userId !== userId) throw new ApiActionError("Media session not found", 404, { error: "Media session not found" });
    if (session.closing && !session.closedAt) throw new ApiActionError("Media session is closed", 410, { error: "Media session is closed" });
    if (session.expiresAt <= clock()) {
      session.closing = true;
      void session.queue.then(() => closeSession(session));
      throw new ApiActionError("Media session expired", 410, { error: "Media session expired" });
    }
    return session;
  }

  function requiredIdentity(value: unknown) {
    if (typeof value !== "string" || value.length < 1 || value.length > 512
      || [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
      throw new ApiActionError("Invalid resource identity", 400, { error: "Invalid resource identity" });
    }
    return value;
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  function hashCapability(capability: string) {
    return createHash("sha256").update(capability).digest();
  }

  function matchesCapability(session: MediaSession, capability: string) {
    const supplied = hashCapability(capability);
    return supplied.length === session.capabilityHash.length && timingSafeEqual(supplied, session.capabilityHash);
  }

  const cleanupTimer = options.startCleanupTimer === false ? null : setInterval(() => {
    const now = clock();
    for (const [id, session] of mediaSessions) {
      if (!session.closedAt && !session.closing && session.expiresAt <= now) {
        session.closing = true;
        void session.queue.then(() => closeSession(session));
      }
      if ((session.closedAt ?? session.expiresAt) + CLOSED_RETENTION_MS <= now) mediaSessions.delete(id);
    }
  }, 60_000);
  cleanupTimer?.unref?.();

  function renewSession(session: MediaSession) {
    session.expiresAt = Math.min(session.createdAt + maxSessionLifetimeMs, clock() + sessionTtlMs);
  }

  return mediaRoute;
}

const mediaRoute = createMediaRoute();
export default mediaRoute;
