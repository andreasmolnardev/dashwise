import type { Hono } from "hono";

import { getMonitoringStatus, runMonitoringStatus } from "@dashwise/sdk/data/monitoring";

import { readAuthToken, readJsonBody, requireAuth, withJson } from "./shared";

export function registerMonitoringControllers(app: Hono) {
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