import { Hono } from "hono";

import { getCurrentSession, renameCurrentSession } from "../lib/data/sessions";
import { readAuth, readJsonBody, readSessionMetadata, requireAuth, withJson } from "./shared";

const sessionsRoute = new Hono();

sessionsRoute
  .get("/api/v1/sessions/current", withJson(async (c) => {
    const requestAuth = readAuth(c);
    const auth = await requireAuth(requestAuth);
    return getCurrentSession(auth.pb, auth.userId, requestAuth.sessionId, readSessionMetadata(c));
  }))
  .patch("/api/v1/sessions/current", withJson(async (c) => {
    const body = await readJsonBody<{ displayName?: unknown }>(c);
    const requestAuth = readAuth(c);
    const auth = await requireAuth(requestAuth);
    return renameCurrentSession(
      auth.pb,
      auth.userId,
      requestAuth.sessionId,
      body.displayName,
      readSessionMetadata(c),
    );
  }));

export default sessionsRoute;
