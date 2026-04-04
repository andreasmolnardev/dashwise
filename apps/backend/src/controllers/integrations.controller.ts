import type { Hono } from "hono";

import { createIntegration, getIntegration, getWidgetProperties, listIntegrations, testIntegrationEndpoint } from "@dashwise/sdk/data/integrations";

import { readAuthToken, readBool, readJsonBody, requireAuth, withJson } from "./shared";

export function registerIntegrationsControllers(app: Hono) {
  app.get("/api/v1/integrations", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    const id = c.req.query("id") ?? undefined;
    const resolveEndpoints = readBool(c.req.query("resolveEndpoints") ?? undefined);
    if (id) {
      return getIntegration(userId, id, resolveEndpoints);
    }
    return listIntegrations(userId);
  }));
  app.post("/api/v1/integrations", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return createIntegration(userId, body?.payload ?? {});
  }));
  app.post("/api/v1/integrations/test-endpoint", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return testIntegrationEndpoint(userId, String(body?.target ?? ""));
  }));
  app.get("/api/v1/integrations/widget-properties", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getWidgetProperties(userId, String(c.req.query("widgetSlug") ?? ""));
  }));
}