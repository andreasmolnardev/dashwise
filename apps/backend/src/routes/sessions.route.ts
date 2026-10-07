import { Hono } from "hono";

import { getCurrentSession, listSessions, renameCurrentSession, revokeSession } from "../lib/data/sessions";
import { readAuth, readJsonBody, readSessionMetadata, requireAuth, withJson } from "./shared";

const sessionsRoute = new Hono();

sessionsRoute
  .get("/api/v1/sessions", withJson(async (c) => {
    const auth = await requireAuth(readAuth(c));
    return listSessions(auth.pb, auth.userId);
  }))
  .delete("/api/v1/sessions/:sessionId", withJson(async (c) => {
    const auth = await requireAuth(readAuth(c));
    return revokeSession(auth.pb, auth.userId, c.req.param("sessionId"));
  }))
  .get("/api/v1/sessions/current", withJson(async (c) => {
    const requestAuth = readAuth(c);
    const auth = await requireAuth(requestAuth);
    return getCurrentSession(auth.pb, auth.userId, auth.sessionId, readSessionMetadata(c));
  }))
  .patch("/api/v1/sessions/current", withJson(async (c) => {
    const body = await readJsonBody<{ displayName?: unknown }>(c);
    const requestAuth = readAuth(c);
    const auth = await requireAuth(requestAuth);
    return renameCurrentSession(
      auth.pb,
      auth.userId,
      auth.sessionId,
      body.displayName,
      readSessionMetadata(c),
    );
  }));

export default sessionsRoute;
