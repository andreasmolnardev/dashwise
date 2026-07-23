import { Hono } from "hono";

import { createMonitor, createMonitoringSshHost, createSystemAgentHost, deleteMonitoringSshHost, deleteSystemAgentHost, getMonitoringSshHosts, getMonitoringStatus, getMonitors, getMonitorById, getSystemAgentHostById, getSystemAgentHosts, getSystemAgentStats, runMonitoringStatus, updateMonitor, updateMonitoringSshHost, updateSystemAgentHost } from "./monitoring-service";
import { deleteMonitoringJob } from "../../../lib/data/superuser";
import { systemAgentClient } from "./system-agent";

import { readAuthToken, readJsonBody, requireAuth, withJson } from "../../../routes/shared";

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
  }))
  .get("/api/v1/monitoring/hosts", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getSystemAgentHosts(userId);
  }))
  .post("/api/v1/monitoring/hosts", withJson(async (c) => {
    const body = await readJsonBody(c);
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    const host = await createSystemAgentHost(userId, body ?? {});
    const configuredHost = await getSystemAgentHostById(userId, host.id);
    if (configuredHost) void systemAgentClient.refresh(configuredHost);
    return host;
  }))
  .put("/api/v1/monitoring/hosts/:id", withJson(async (c) => {
    const body = await readJsonBody(c);
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    const hostId = c.req.param("id") || "";
    const host = await updateSystemAgentHost(userId, hostId, body ?? {});
    if (!host) return { _status: 404, error: "System Agent host not found" };
    systemAgentClient.stop(hostId);
    const configuredHost = await getSystemAgentHostById(userId, host.id);
    if (configuredHost) void systemAgentClient.refresh(configuredHost);
    return host;
  }))
  .delete("/api/v1/monitoring/hosts/:id", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    const hostId = c.req.param("id") || "";
    const result = await deleteSystemAgentHost(userId, hostId);
    systemAgentClient.stop(hostId);
    return result;
  }))
  .get("/api/v1/monitoring/hosts/:id/stats", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    const stats = await getSystemAgentStats(userId, c.req.param("id") || "");
    if (!stats) return { _status: 404, error: "System Agent host or stats not found" };
    return stats;
  }))
  .get("/api/v1/monitoring/hosts/:id/history", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    const host = await getSystemAgentHostById(userId, c.req.param("id") || "");
    if (!host) return { _status: 404, error: "System Agent host not found" };
    return systemAgentClient.history(host, c.req.query("timestamp"));
  }))
  .post("/api/v1/monitoring/hosts/:id/refresh", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    const host = await getSystemAgentHostById(userId, c.req.param("id") || "");
    if (!host) return { _status: 404, error: "System Agent host not found" };
    await systemAgentClient.refresh(host);
    return getSystemAgentStats(userId, host.id);
  }));

export default monitoringRoute;
