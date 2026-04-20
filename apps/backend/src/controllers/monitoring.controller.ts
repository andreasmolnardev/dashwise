import type { Hono } from "hono";

import { getMonitoringStatus, getMonitors, getMonitorById, runMonitoringStatus } from "@dashwise/sdk/data/monitoring";

import { readAuthToken, readJsonBody, requireAuth, withJson } from "./shared";

export function registerMonitoringControllers(app: Hono) {
  app.get("/api/v1/monitors", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getMonitors(userId);
  }));

  app.get("/api/v1/monitors/:id", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getMonitorById(userId, c.req.param("id") || "");
  }));

  app.get("/api/v1/monitoringStatus", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getMonitoringStatus(userId, c.req.query("jobId") ?? null);
  }));
  app.post("/api/v1/monitoringStatus", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return runMonitoringStatus(userId, body?.body ?? {});
  }));
}