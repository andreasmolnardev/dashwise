import { Hono } from "hono";

import { createMonitor, createMonitoringSshHost, deleteMonitoringSshHost, getMonitoringSshHosts, getMonitoringStatus, getMonitors, getMonitorById, runMonitoringStatus, updateMonitor, updateMonitoringSshHost } from "../lib/data/monitoring";
import { deleteMonitoringJob } from "../lib/data/superuser";

import { readAuthToken, readJsonBody, requireAuth, withJson } from "./shared";

const monitoringRoute = new Hono();

monitoringRoute
  .get("/api/v1/monitors", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getMonitors(userId);
  }))
  .post("/api/v1/monitors", withJson(async (c) => {
    const body = await readJsonBody(c);
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return createMonitor(userId, body ?? {});
  }))
  .get("/api/v1/monitors/:id", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getMonitorById(userId, c.req.param("id") || "");
  }))
  .put("/api/v1/monitors/:id", withJson(async (c) => {
    const body = await readJsonBody(c);
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
    const body = await readJsonBody(c);
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return runMonitoringStatus(userId, body ?? {});
  }))
  .get("/api/v1/monitoring/ssh-hosts", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getMonitoringSshHosts(userId);
  }))
  .post("/api/v1/monitoring/ssh-hosts", withJson(async (c) => {
    const body = await readJsonBody(c);
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return createMonitoringSshHost(userId, body ?? {});
  }))
  .put("/api/v1/monitoring/ssh-hosts/:id", withJson(async (c) => {
    const body = await readJsonBody(c);
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    const updated = await updateMonitoringSshHost(userId, c.req.param("id") || "", body ?? {});
    if (!updated) return { _status: 404, error: "SSH host not found" };
    return updated;
  }))
  .delete("/api/v1/monitoring/ssh-hosts/:id", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return deleteMonitoringSshHost(userId, c.req.param("id") || "");
  }));

export default monitoringRoute;
