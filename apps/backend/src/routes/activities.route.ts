import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import {
  ActivityInputError,
  deleteActivity,
  getActivity,
  listActivities,
  publishIntegrationActivity,
  validateActivityQuery,
} from "../lib/data/activities";
import { ApiActionError } from "../lib/data/auth";
import { readAuthToken, readJsonBody, requireAuth, withJson } from "./shared";

const activitiesRoute = new Hono();

async function requireActivityOwner(token: string | null) {
  const { userId } = await requireAuth({ token });
  if (!userId) throw new ApiActionError("Unauthorized", 401, { error: "Unauthorized" });
  return userId;
}

activitiesRoute.get("/api/v1/activities", withJson(async (c) => {
  const userId = await requireActivityOwner(readAuthToken(c));
  const query = validateActivityQuery(c.req.query());
  return listActivities(userId, query);
}));

activitiesRoute.get("/api/v1/activities/:id", withJson(async (c) => {
  const userId = await requireActivityOwner(readAuthToken(c));
  const activity = await getActivity(userId, c.req.param("id"));
  if (!activity) throw new ApiActionError("Activity not found", 404, { error: "Activity not found" });
  return { activity };
}));

activitiesRoute.delete("/api/v1/activities/:id", withJson(async (c) => {
  const userId = await requireActivityOwner(readAuthToken(c));
  const deleted = await deleteActivity(userId, c.req.param("id"));
  if (!deleted) throw new ApiActionError("Activity not found", 404, { error: "Activity not found" });
  return { ok: true };
}));

activitiesRoute.post(
  "/api/v1/integrations/:integrationId/activities",
  bodyLimit({ maxSize: 100 * 1024, onError: (c) => c.json({ error: "Activity payload exceeds the 100 KB limit" }, 413) }),
  async (c) => {
    try {
      const userId = await requireActivityOwner(readAuthToken(c));
      const result = await publishIntegrationActivity(
        userId,
        c.req.param("integrationId"),
        await readJsonBody(c),
      );
      return c.json(result, result.duplicate ? 200 : 201);
    } catch (error) {
      if (error instanceof ActivityInputError) return c.json({ error: error.message }, 400);
      if (error instanceof ApiActionError) return c.json(error.body ?? { error: error.message }, error.status as 401 | 403 | 404 | 429);
      const status = typeof error === "object" && error && "status" in error && typeof error.status === "number"
        ? error.status
        : 500;
      return c.json({ error: "Internal Server Error" }, status as 400 | 401 | 403 | 404 | 413 | 429 | 500);
    }
  },
);

export default activitiesRoute;
