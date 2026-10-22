import { Hono } from "hono";

import { getCurrentSession, listSessions, renameCurrentSession, revokeSession } from "../lib/data/sessions";
import { readAuth, readJsonBody, readSessionMetadata, requireAuth, withJson } from "./shared";

import { isSessionConnected, sendToSession } from "../lib/activity";
import { ApiActionError } from "../lib/data/auth";

const sessionsRoute = new Hono();

// Deliver only to an active session owned by this user. The receiver asks before opening.
sessionsRoute.post("/api/v1/sessions/:sessionId/links", withJson(async (c) => {
  const auth = await requireAuth(readAuth(c));
  const target = c.req.param("sessionId");
  const sessions = await listSessions(auth.userId);
  const session = sessions.find((item) => item.sessionId === target && !item.revokedAt);
  if (!target || !session) throw new ApiActionError("Device not found", 404, { error: "Device not found" });
  const body = await readJsonBody<{ url?: unknown; title?: unknown }>(c);
  let url: URL;
  try {
    if (typeof body.url !== "string" || body.url.length > 8192) throw new Error();
    url = new URL(body.url);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
  } catch {
    throw new ApiActionError("A valid HTTP or HTTPS URL is required", 400, { error: "A valid HTTP or HTTPS URL is required" });
  }
  const requestId = crypto.randomUUID();
  const delivered = sendToSession(auth.userId, target, {
    type: "link:received", requestId, url: url.href,
    title: typeof body.title === "string" ? body.title.slice(0, 300) : url.hostname,
  });
  if (!delivered) throw new ApiActionError("Device is offline. Open Dashwise on that device first.", 503, { error: "Device is offline. Open Dashwise on that device first." });
  return { success: true, requestId };
}));

sessionsRoute
  .get("/api/v1/sessions", withJson(async (c) => {
    const auth = await requireAuth(readAuth(c));
    return (await listSessions(auth.userId)).map(session => ({ ...session, connected: isSessionConnected(auth.userId, session.sessionId) }));
  }))
  .delete("/api/v1/sessions/:sessionId", withJson(async (c) => {
    const auth = await requireAuth(readAuth(c));
    return revokeSession(auth.userId, c.req.param("sessionId"));
  }))
  .get("/api/v1/sessions/current", withJson(async (c) => {
    const requestAuth = readAuth(c);
    const auth = await requireAuth(requestAuth);
    return getCurrentSession(auth.userId, auth.sessionId, readSessionMetadata(c));
  }))
  .patch("/api/v1/sessions/current", withJson(async (c) => {
    const body = await readJsonBody<{ displayName?: unknown }>(c);
    const requestAuth = readAuth(c);
    const auth = await requireAuth(requestAuth);
    return renameCurrentSession(
      auth.userId,
      auth.sessionId,
      body.displayName,
      readSessionMetadata(c),
    );
  }));

export default sessionsRoute;
