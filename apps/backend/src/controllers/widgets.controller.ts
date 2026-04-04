import type { Hono } from "hono";

import { getIntegrationWithWidget } from "@dashwise/sdk/data/integrations";
import { getUserGlanceable, getUserWidgets } from "@dashwise/sdk/data/widgets";

import { readAuthToken, requireAuth, withJson } from "./shared";

export function registerWidgetsControllers(app: Hono) {
  app.get("/api/v1/widgets", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getUserWidgets(userId);
  }));
  app.get("/api/v1/glanceables", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getUserGlanceable(userId);
  }));
  app.get("/api/v1/widgets/glanceable", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getUserGlanceable(userId);
  }));
  app.get("/api/v1/widgets/glanceables", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getUserGlanceable(userId);
  }));
  app.get("/api/v1/widgets/by-integration", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getIntegrationWithWidget(userId, String(c.req.query("widgetKey") ?? ""));
  }));
}