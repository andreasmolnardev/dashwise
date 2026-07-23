import { Hono } from "hono";
import {
  getFrequentlyUsedSearchItems,
  getSearchItems,
  recordSearchItemUsage,
} from "./internal/service";

import { readAuthToken, readJsonBody, requireAuth, withJson } from "../../routes/shared";

const searchItemsRoute = new Hono();

searchItemsRoute
  .get(
    "/api/v1/searchItems",
    withJson(async (c) => {
      const { userId } = await requireAuth({ token: readAuthToken(c) });
      return getSearchItems(userId);
    }),
  )
  .post("/api/v1/searchItems/usageStats", withJson(async (c) => {
    const body = await readJsonBody<{ id: string; timestamp: string; auth?: any }>(c);
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    
    if (!body.id || !body.timestamp) {
      return { success: false, error: "Missing id or timestamp" };
    }

    if (!await recordSearchItemUsage(userId, body.id, body.timestamp)) {
       return { success: false, error: "Unauthorized" };
    }

    return { success: true };
  }))
  .get("/api/v1/searchItems/frequentlyUsed", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    
    return getFrequentlyUsedSearchItems(userId);
  }));

export default searchItemsRoute;
