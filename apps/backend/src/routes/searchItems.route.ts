import { Hono } from "hono";
import { getSuperuserPB } from "../lib/pb/pocketbase";
import { getSearchItems } from "../lib/data/searchItems";

import { readAuthToken, readJsonBody, requireAuth, withJson } from "./shared";

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

    const pb = await getSuperuserPB();
    const record = await pb.collection("searchItems").getOne(body.id);
    
    if (record.user !== userId) {
       return { success: false, error: "Unauthorized" };
    }
    
    const usageStats = Array.isArray(record.usageStats) ? record.usageStats : [];
    usageStats.push({ timestamp: body.timestamp });
    
    // Keep only last 100 usages to prevent infinite growth
    if (usageStats.length > 100) {
      usageStats.shift();
    }

    await pb.collection("searchItems").update(body.id, { usageStats });

    return { success: true };
  }))
  .get("/api/v1/searchItems/frequentlyUsed", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    
    const pb = await getSuperuserPB();
    const records = await pb.collection("searchItems").getFullList(1000, {
      filter: `user="${userId.replace(/"/g, '\\"')}"`,
    });

    const sorted = records
      .map(record => ({
        id: record.id,
        usageCount: Array.isArray(record.usageStats) ? record.usageStats.length : 0,
      }))
      .filter(record => record.usageCount > 0)
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, 5);

    return sorted.map(item => ({ id: item.id }));
  }));

export default searchItemsRoute;
