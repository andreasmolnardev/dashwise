import { Hono } from "hono";

import {
  getIntegrationWithConsumer,
} from "@dashwise/sdk/data/integrations";
import { getUserGlanceable, getUserWidgets } from "@dashwise/sdk/data/widgets";

import { readAuthToken, requireAuth, withJson } from "./shared";

const widgetsRoute = new Hono();
  widgetsRoute.get("/api/v1/widgets", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getUserWidgets(userId);
  }));
  widgetsRoute.get("/api/v1/glanceables", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getUserGlanceable(userId);
  }));
  widgetsRoute.get("/api/v1/widgets/glanceable", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getUserGlanceable(userId);
  }));
  widgetsRoute.get("/api/v1/widgets/glanceables", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getUserGlanceable(userId);
  }));
  widgetsRoute.get("/api/v1/widgets/by-integration", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getIntegrationWithConsumer(userId, { widgetKey: String(c.req.query("widgetKey") ?? "") });
  }));
  widgetsRoute.get("/api/v1/glanceables/by-integration", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getIntegrationWithConsumer(userId, { glanceableType: String(c.req.query("glanceableType") ?? "") });
  }));

export default widgetsRoute;
