import { Hono } from "hono";

import {
  createOnDemandShortcutApp,
  getShortcuts,
  syncOnDemandShortcuts,
} from "../lib/data/shortcuts";
import { getSuperuserPB } from "../lib/pb/pocketbase";
import { ApiActionError } from "../lib/data/auth";
import { readAuthToken, readJsonBody, requireAuth, withJson } from "./shared";

const shortcutsRoute = new Hono();

shortcutsRoute
  .get(
    "/api/v1/shortcuts",
    withJson(async (c) => {
      const { userId } = await requireAuth({ token: readAuthToken(c) });
      return getShortcuts(userId);
    }),
  )
  .post(
    "/api/v1/shortcuts/apps",
    withJson(async (c) => {
      const body = await readJsonBody<{ name?: unknown; type?: unknown; icon?: unknown }>(c);
      const { userId } = await requireAuth({ token: readAuthToken(c) });
      return createOnDemandShortcutApp(userId, body ?? {});
    }),
  )
  .put(
    "/api/v1/shortcuts/on-demand/:appId",
    withJson(async (c) => {
      const body = await readJsonBody<{ shortcuts?: unknown }>(c);
      const { userId } = await requireAuth({ token: readAuthToken(c) });
      return syncOnDemandShortcuts(userId, String(c.req.param("appId") ?? ""), body?.shortcuts);
    }),
  )
  .post(
    "/api/v1/shortcuts/usageStats",
    withJson(async (c) => {
      const body = await readJsonBody<{ id?: string; timestamp?: string }>(c);
      const { userId } = await requireAuth({ token: readAuthToken(c) });
      const id = String(body?.id ?? "").trim();
      const timestamp = String(body?.timestamp ?? "").trim();

      if (!id || !timestamp) {
        throw new ApiActionError("Missing id or timestamp", 400, {
          error: "Missing id or timestamp",
        });
      }

      const pb = await getSuperuserPB();
      const record = await pb.collection("shortcuts").getOne(id);
      if (record.user !== userId) {
        throw new ApiActionError("Unauthorized", 403, { error: "Unauthorized" });
      }

      const usageStats = Array.isArray(record.usageStats) ? record.usageStats : [];
      usageStats.push({ timestamp });
      if (usageStats.length > 100) usageStats.shift();

      await pb.collection("shortcuts").update(id, { usageStats });
      return { success: true };
    }),
  )
  .get(
    "/api/v1/shortcuts/frequentlyUsed",
    withJson(async (c) => {
      const { userId } = await requireAuth({ token: readAuthToken(c) });
      const pb = await getSuperuserPB();
      const records = await pb.collection("shortcuts").getFullList(1000, {
        filter: `user="${userId.replace(/"/g, '\\"')}"`,
      });

      return records
        .map((record) => ({
          id: record.id,
          usageCount: Array.isArray(record.usageStats) ? record.usageStats.length : 0,
        }))
        .filter((record) => record.usageCount > 0)
        .sort((a, b) => b.usageCount - a.usageCount)
        .slice(0, 5)
        .map((item) => ({ id: item.id }));
    }),
  );

export default shortcutsRoute;
