import { Hono } from "hono";

import { createMonitor, getMonitoringStatus, getMonitors, getMonitorById, runMonitoringStatus, updateMonitor } from "../lib/data/monitoring";
import { deleteMonitoringJob } from "../lib/data/superuser";

import { readAuthToken, readJsonBody, requireAuth, withJson } from "./shared";

const monitoringRoute = new Hono();

monitoringRoute
  .get("/api/v1/monitors", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getMonitors(userId);
  }))
  .post("/api/v1/monitors", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return createMonitor(userId, body ?? {});
  }))
  .get("/api/v1/monitors/:id", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getMonitorById(userId, c.req.param("id") || "");
  }))
  .put("/api/v1/monitors/:id", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    const monitorId = c.req.param("id") || "";
    const updated = await updateMonitor(userId, monitorId, body ?? {});
    if (!updated) {
      return { _status: 404, error: "Monitor not found" };
    }
    return updated;
  }))
  .delete("/api/v1/monitors/:id", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    const monitorId = c.req.param("id") || "";
    const monitor = await getMonitorById(userId, monitorId);
    if (!monitor) {
      return { _status: 404, error: "Monitor not found" };
    }
    return deleteMonitoringJob(monitorId);
  }))
  .get("/api/v1/monitoringStatus", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getMonitoringStatus(userId, c.req.query("jobId") ?? null);
  }))
  .post("/api/v1/monitoringStatus", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return runMonitoringStatus(userId, body ?? {});
  }));

export default monitoringRoute;
