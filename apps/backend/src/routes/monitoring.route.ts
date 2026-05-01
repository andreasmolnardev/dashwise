import { Hono } from "hono";

import { createMonitor, getMonitoringStatus, getMonitors, getMonitorById, runMonitoringStatus } from "@dashwise/sdk/data/monitoring";
import { deleteMonitoringJob } from "@dashwise/sdk/data/superuser";

import { readAuthToken, readJsonBody, requireAuth, withJson } from "./shared";

const monitoringRoute = new Hono();
  monitoringRoute.get("/api/v1/monitors", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getMonitors(userId);
  }));

  monitoringRoute.post("/api/v1/monitors", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return createMonitor(userId, body ?? {});
  }));

  monitoringRoute.get("/api/v1/monitors/:id", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getMonitorById(userId, c.req.param("id") || "");
  }));

  monitoringRoute.delete("/api/v1/monitors/:id", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    const monitorId = c.req.param("id") || "";
    const monitor = await getMonitorById(userId, monitorId);
    if (!monitor) {
      return { _status: 404, error: "Monitor not found" };
    }
    return deleteMonitoringJob(monitorId);
  }));

  monitoringRoute.get("/api/v1/monitoringStatus", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getMonitoringStatus(userId, c.req.query("jobId") ?? null);
  }));
  monitoringRoute.post("/api/v1/monitoringStatus", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return runMonitoringStatus(userId, body?.body ?? {});
  }));

export default monitoringRoute;
