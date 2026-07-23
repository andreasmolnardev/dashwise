import { config } from "../../../lib/config";
import { decryptSecret, encryptSecret } from "../../../lib/crypto";
import { getSuperuserPB } from "../../../lib/pb/pocketbase";
import type { MonitorsResponse } from "@dashwise/types";

export type MonitorPing = {
  status?: string;
  created?: string;
  dateChanged?: string;
  httpStatus?: number;
  method?: string;
  endpoint?: string;
  latencyMs?: number;
  [key: string]: unknown;
};

type OutlierThreshold = {
  type: "absolute" | "relative";
  value: number;
};

export interface MonitorRecord extends Pick<
  MonitorsResponse<unknown, unknown, unknown, unknown>,
  | "id"
  | "endpoint"
  | "endpointAuth"
  | "notifyOnStatusChange"
  | "notifyTopicId"
  | "pingAvgLatency"
  | "pingOutlierThreshold"
  | "pingOutliers"
  | "pings"
  | "responseUpFilter"
  | "source"
  | "sourcelinkId"
  | "status"
  | "created"
  | "updated"
> {
  method?: string;
  linkId?: string;
  [key: string]: unknown;
}

export type MonitoringSshHostRecord = {
  id: string;
  userId: string;
  name: string;
  hostname: string;
  port: number;
  username: string;
  authMethod: "password" | "key" | "agent";
  authType?: "password" | "key" | "agent";
  credentialEncrypted?: string;
  hasCredential?: boolean;
  status?: string;
  created?: string;
  updated?: string;
  [key: string]: unknown;
};

export type SystemAgentHostRecord = MonitoringSshHostRecord & {
  type: "monitor";
  systemInfo?: {
    url?: string;
    liveUrl?: string;
    [key: string]: unknown;
  };
};

type MonitorStatusSummary = {
  status: string;
  dateChanged: string | null;
  durationChanged: number | null;
};

function normalizeStatus(rawStatus: unknown): string {
  if (Array.isArray(rawStatus)) {
    return String(rawStatus[0] || "initiated");
  }
  return String(rawStatus || "initiated");
}

function parsePings(raw: unknown): MonitorPing[] {
  if (!raw) return [];

  if (Array.isArray(raw)) {
    return raw;
  }

  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return [];
}

function normalizeMethod(rawMethod?: unknown): string {
  const method = String(rawMethod || "GET").trim().toUpperCase();
  const allowed = new Set(["GET", "POST", "PUT", "DELETE", "PATCH"]);
  return allowed.has(method) ? method : "GET";
}

function normalizeResponseUpFilter(rawFilter: unknown, fallbackStatusCodes?: unknown) {
  const normalized: Record<string, unknown> = {};

  const source = parseFilterValue(rawFilter);
  if (source && typeof source === "object" && !Array.isArray(source)) {
    if ((source as any).acceptStatusCodes !== undefined) {
      normalized.acceptStatusCodes = (source as any).acceptStatusCodes;
    }
    if ((source as any).acceptBodyProperties !== undefined) {
      normalized.acceptBodyProperties = (source as any).acceptBodyProperties;
    }
  }

  if (normalized.acceptStatusCodes === undefined && fallbackStatusCodes !== undefined) {
    normalized.acceptStatusCodes = fallbackStatusCodes;
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function parseFilterValue(raw: unknown): unknown {
  if (raw === undefined || raw === null || raw === "") {
    return undefined;
  }

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;

    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }

  return raw;
}

function getDefaultOutlierThreshold(): OutlierThreshold {
  return {
    type: config.MONITORING_OUTLIER_THRESHOLD_TYPE,
    value: config.MONITORING_OUTLIER_THRESHOLD_VALUE,
  };
}

function getLatestMonitorStatus(monitor: any): MonitorStatusSummary {
  const pings = parsePings(monitor.pings);
  let latestStatus = normalizeStatus(monitor.status);
  let dateChanged: string | null = null;
  let durationChanged: number | null = null;

  if (pings.length > 0) {
    const latestPing = pings[pings.length - 1];
    latestStatus = normalizeStatus(latestPing.status);
    dateChanged = String(latestPing.created || latestPing.dateChanged || null);

    if (pings.length > 1) {
      const prevPing = pings[pings.length - 2];
      const latestTime = new Date(dateChanged).getTime();
      const prevTime = new Date(String(prevPing.created || prevPing.dateChanged || "")).getTime();

      if (!Number.isNaN(latestTime) && !Number.isNaN(prevTime)) {
        durationChanged = (latestTime - prevTime) / 1000;
      }
    }
  } else {
    dateChanged = String(monitor.updated || monitor.created || null);
  }

  return { status: latestStatus, dateChanged, durationChanged };
}

export async function getMonitors(userId: string) {
  const pb = await getSuperuserPB();
  return pb.collection("monitors").getFullList({ filter: `userId = "${userId}"` });
}

export async function getMonitorById(userId: string, monitorId: string) {
  const pb = await getSuperuserPB();

  try {
    const monitor = await pb.collection("monitors").getOne(monitorId);
    return monitor?.userId === userId ? monitor : null;
  } catch {
    return null;
  }
}

function normalizeSshHostPayload(userId: string, body: any, partial = false) {
  const payload: Record<string, unknown> = { userId };

  if (!partial || body?.name !== undefined) {
    const name = String(body?.name ?? "").trim();
    if (!name) throw new Error("Host name is required");
    payload.name = name;
  }

  if (!partial || body?.hostname !== undefined) {
    const hostname = String(body?.hostname ?? "").trim();
    if (!hostname) throw new Error("Hostname is required");
    payload.hostname = hostname;
  }

  if (!partial || body?.port !== undefined) {
    const port = Number(body?.port ?? 22);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("Port must be between 1 and 65535");
    }
    payload.port = port;
  }

  if (!partial || body?.username !== undefined) {
    const username = String(body?.username ?? "").trim();
    if (!username) throw new Error("Username is required");
    payload.username = username;
  }

  if (!partial || body?.authMethod !== undefined || body?.authType !== undefined) {
    const authType = String(body?.authMethod ?? body?.authType ?? "password");
    if (!["password", "key", "agent"].includes(authType)) {
      throw new Error("Unsupported SSH auth method");
    }
    payload.authType = authType;
  }

  const authType = String(payload.authType ?? body?.authMethod ?? body?.authType ?? "password");
  const password = typeof body?.password === "string" ? body.password : "";
  const publicKey = typeof body?.publicKey === "string" ? body.publicKey : "";
  const privateKey = typeof body?.privateKey === "string" ? body.privateKey : "";

  if (password || publicKey || privateKey || (!partial && (authType === "password" || authType === "key"))) {
    if (authType === "password") {
      if (!password) throw new Error("Password is required");
      payload.credentialEncrypted = encryptSecret({ method: "password", password });
    } else if (authType === "key") {
      if (!publicKey || !privateKey) throw new Error("Public and private keys are required");
      payload.credentialEncrypted = encryptSecret({ method: "key", publicKey, privateKey });
    }
  }

  if (body?.status !== undefined) {
    payload.status = String(body.status || "unknown");
  } else if (!partial) {
    payload.status = "unknown";
  }

  return payload;
}

function sanitizeSshHost(host: any): MonitoringSshHostRecord {
  const { credentialEncrypted, ...safeHost } = host || {};
  return {
    ...safeHost,
    authMethod: safeHost.authType || safeHost.authMethod,
    hasCredential: Boolean(credentialEncrypted),
  } as MonitoringSshHostRecord;
}

export function getMonitoringSshHostCredentials<T = unknown>(host: MonitoringSshHostRecord | null) {
  return decryptSecret<T>(host?.credentialEncrypted || null);
}

export async function getMonitoringSshHosts(userId: string): Promise<MonitoringSshHostRecord[]> {
  const pb = await getSuperuserPB();
  const hosts = await pb.collection("monitoringHosts").getFullList({ filter: `userId = "${userId}" && type = "ssh"`, sort: "name" });
  return hosts.map(sanitizeSshHost);
}

export async function getMonitoringSshHostById(userId: string, hostId: string): Promise<MonitoringSshHostRecord | null> {
  const pb = await getSuperuserPB();
  const host = await pb.collection("monitoringHosts").getOne(hostId).catch(() => null);
  return host?.userId === userId && host.type === "ssh" ? host as any : null;
}

export async function getSafeMonitoringSshHostById(userId: string, hostId: string): Promise<MonitoringSshHostRecord | null> {
  const host = await getMonitoringSshHostById(userId, hostId);
  return host ? sanitizeSshHost(host) : null;
}

export async function createMonitoringSshHost(userId: string, body: any): Promise<MonitoringSshHostRecord> {
  const pb = await getSuperuserPB();
  const host = await pb.collection("monitoringHosts").create({ ...normalizeSshHostPayload(userId, body), type: "ssh" });
  return sanitizeSshHost(host);
}

export async function updateMonitoringSshHost(userId: string, hostId: string, body: any): Promise<MonitoringSshHostRecord | null> {
  const pb = await getSuperuserPB();
  const host = await getMonitoringSshHostById(userId, hostId);
  if (!host) return null;
  const updated = await pb.collection("monitoringHosts").update(hostId, normalizeSshHostPayload(userId, body, true));
  return sanitizeSshHost(updated);
}

export async function deleteMonitoringSshHost(userId: string, hostId: string) {
  const pb = await getSuperuserPB();
  const host = await getMonitoringSshHostById(userId, hostId);
  if (!host) return { _status: 404, error: "SSH host not found" };
  await pb.collection("monitoringHosts").delete(hostId);
  return { success: true };
}

function normalizeSystemAgentPayload(userId: string, body: any, partial = false) {
  const payload: Record<string, unknown> = { userId, type: "monitor", authType: "agent", username: "agent" };

  if (!partial || body?.name !== undefined) {
    const name = String(body?.name ?? "").trim();
    if (!name) throw new Error("Host name is required");
    payload.name = name;
  }

  if (!partial || body?.url !== undefined) {
    const rawUrl = String(body?.url ?? "").trim();
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new Error("System Agent URL must be a valid HTTP URL");
    }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      throw new Error("System Agent URL must be an HTTP origin without credentials or path");
    }
    payload.hostname = url.hostname;
    payload.port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
    payload.systemInfo = { url: url.origin };
  }

  if (body?.liveUrl !== undefined) {
    const liveUrl = String(body.liveUrl || "").trim();
    if (liveUrl) {
      let url: URL;
      try {
        url = new URL(liveUrl);
      } catch {
        throw new Error("System Agent live URL must be a valid WebSocket URL");
      }
      if (!["ws:", "wss:"].includes(url.protocol) || url.username || url.password) {
        throw new Error("System Agent live URL must be a WebSocket URL without credentials");
      }
      payload.systemInfo = { ...(payload.systemInfo as object), liveUrl: url.toString() };
    } else {
      payload.systemInfo = { ...(payload.systemInfo as object), liveUrl: null };
    }
  }

  if (body?.token !== undefined) {
    const token = String(body.token || "").trim();
    if (!token) throw new Error("System Agent token is required");
    payload.credentialEncrypted = encryptSecret({ token });
  } else if (!partial) {
    throw new Error("System Agent token is required");
  }

  return payload;
}

export function getSystemAgentUrl(host: SystemAgentHostRecord): string {
  const url = host.systemInfo?.url;
  if (typeof url === "string" && url) return url;
  return `http://${host.hostname}:${host.port}`;
}

export async function getSystemAgentHosts(userId: string): Promise<SystemAgentHostRecord[]> {
  const pb = await getSuperuserPB();
  const hosts = await pb.collection("monitoringHosts").getFullList({ filter: `userId = "${userId}" && type = "monitor"`, sort: "name" });
  return hosts.map(sanitizeSshHost) as SystemAgentHostRecord[];
}

export async function getSystemAgentHostById(userId: string, hostId: string): Promise<SystemAgentHostRecord | null> {
  const pb = await getSuperuserPB();
  const host = await pb.collection("monitoringHosts").getOne(hostId).catch(() => null);
  return host?.userId === userId && host.type === "monitor" ? host as unknown as SystemAgentHostRecord : null;
}

export async function getAllSystemAgentHosts(): Promise<SystemAgentHostRecord[]> {
  const pb = await getSuperuserPB();
  return await pb.collection("monitoringHosts").getFullList({ filter: `type = "monitor"` }) as unknown as SystemAgentHostRecord[];
}

export function getSystemAgentToken(host: SystemAgentHostRecord): string | null {
  const credential = decryptSecret<{ token?: string }>(host.credentialEncrypted);
  return typeof credential?.token === "string" && credential.token ? credential.token : null;
}

export async function createSystemAgentHost(userId: string, body: any): Promise<SystemAgentHostRecord> {
  const pb = await getSuperuserPB();
  const host = await pb.collection("monitoringHosts").create(normalizeSystemAgentPayload(userId, body));
  return sanitizeSshHost(host) as SystemAgentHostRecord;
}

export async function updateSystemAgentHost(userId: string, hostId: string, body: any): Promise<SystemAgentHostRecord | null> {
  const pb = await getSuperuserPB();
  const host = await getSystemAgentHostById(userId, hostId);
  if (!host) return null;
  const payload = normalizeSystemAgentPayload(userId, body, true);
  if (payload.systemInfo && host.systemInfo) payload.systemInfo = { ...host.systemInfo, ...(payload.systemInfo as object) };
  const updated = await pb.collection("monitoringHosts").update(hostId, payload);
  return sanitizeSshHost(updated) as SystemAgentHostRecord;
}

export async function deleteSystemAgentHost(userId: string, hostId: string) {
  const pb = await getSuperuserPB();
  const host = await getSystemAgentHostById(userId, hostId);
  if (!host) return { _status: 404, error: "System Agent host not found" };
  await Promise.all([
    pb.collection("monitoringHosts").delete(hostId),
    pb.collection("monitoringHostsStats").delete(hostId).catch(() => undefined),
  ]);
  return { success: true };
}

export async function saveSystemAgentStats(hostId: string, stats: Record<string, unknown>) {
  const pb = await getSuperuserPB();
  try {
    return await pb.collection("monitoringHostsStats").update(hostId, { stats });
  } catch {
    try {
      return await pb.collection("monitoringHostsStats").create({ id: hostId, stats });
    } catch {
      // HTTP polling and live updates may race while first stats record is created.
      return pb.collection("monitoringHostsStats").update(hostId, { stats });
    }
  }
}

export async function getSystemAgentStats(userId: string, hostId: string) {
  const host = await getSystemAgentHostById(userId, hostId);
  if (!host) return null;
  const pb = await getSuperuserPB();
  return pb.collection("monitoringHostsStats").getOne(hostId).catch(() => null);
}

export async function updateSystemAgentConnection(hostId: string, status: "online" | "offline", systemInfo?: Record<string, unknown>) {
  const pb = await getSuperuserPB();
  return pb.collection("monitoringHosts").update(hostId, {
    status,
    ...(systemInfo ? { systemInfo: { ...systemInfo, lastConnectedAt: status === "online" ? new Date().toISOString() : systemInfo.lastConnectedAt } } : {}),
  });
}

export async function getMonitoringStatus(userId: string, jobId?: string | null) {
  const pb = await getSuperuserPB();

  const monitors = jobId
    ? await pb
        .collection("monitors")
        .getFullList({ filter: `id = "${jobId}" && userId = "${userId}"` })
    : await pb.collection("monitors").getFullList({ filter: `userId = "${userId}"` });

  if (!monitors || monitors.length === 0) {
    return {};
  }

  const results: Record<
    string,
    { id: string; status: string; dateChanged: string | null; durationChanged: number | null; endpoint?: string }
  > = {};

  for (const monitor of monitors) {
    const statusSummary = getLatestMonitorStatus(monitor);
    const key = monitor.sourcelinkId || monitor.linkId || monitor.id;
    results[key] = {
      id: monitor.id,
      status: statusSummary.status,
      dateChanged: statusSummary.dateChanged,
      durationChanged: statusSummary.durationChanged,
      endpoint: monitor.endpoint,
    };
  }

  return results;
}

export async function createMonitor(userId: string, body: any) {
  const pb = await getSuperuserPB();

  const endpoint = String(body?.endpoint ?? "").trim();
  if (!endpoint) {
    throw new Error("Endpoint is required");
  }

  const resourceType = String(body?.resourceType ?? "link");
  if (resourceType === "system") {
    throw new Error("System monitors are not supported yet");
  }

  const linkId = String(body?.linkId ?? "").trim();
  if (!linkId) {
    throw new Error("Link selection is required");
  }

  const responseUpFilter = normalizeResponseUpFilter(body?.responseUpFilter, body?.acceptedUpStatusCodes);
  const defaultOutlierThreshold = getDefaultOutlierThreshold();

  const payload: Record<string, unknown> = {
    userId,
    endpoint,
    method: normalizeMethod(body?.method),
    sourcelinkId: linkId,
    status: "initiated",
    pingAvgLatency: JSON.stringify({ avgMs: 0, samples: 0 }),
    pingOutliers: [],
    pingOutlierThreshold: body?.pingOutlierThreshold ?? defaultOutlierThreshold,
    notifyOnStatusChange: false,
    notifyTopicId: "",
  };

  const endpointAuth = parseFilterValue(body?.endpointAuth);
  if (endpointAuth !== undefined) {
    payload.endpointAuth = endpointAuth;
  }

  if (responseUpFilter !== undefined) {
    payload.responseUpFilter = responseUpFilter;
  }

  return pb.collection("monitors").create(payload);
}

export async function updateMonitor(userId: string, monitorId: string, body: any) {
  const pb = await getSuperuserPB();

  const monitor = await pb.collection("monitors").getOne(monitorId).catch(() => null);
  if (!monitor || monitor.userId !== userId) {
    return null;
  }

  const payload: Record<string, unknown> = {};

  if (body?.endpoint !== undefined) {
    const endpoint = String(body?.endpoint ?? "").trim();
    if (!endpoint) {
      throw new Error("Endpoint is required");
    }
    payload.endpoint = endpoint;
  }

  if (body?.method !== undefined) {
    payload.method = normalizeMethod(body?.method);
  }

  if (body?.endpointAuth !== undefined) {
    const endpointAuth = parseFilterValue(body?.endpointAuth);
    payload.endpointAuth = endpointAuth ?? "";
  }

  if (body?.responseUpFilter !== undefined || body?.acceptedUpStatusCodes !== undefined) {
    const responseUpFilter = normalizeResponseUpFilter(body?.responseUpFilter, body?.acceptedUpStatusCodes);
    payload.responseUpFilter = responseUpFilter ?? "";
  }

  if (body?.pingOutlierThreshold !== undefined) {
    payload.pingOutlierThreshold = body?.pingOutlierThreshold;
  }

  if (body?.notifyOnStatusChange !== undefined) {
    payload.notifyOnStatusChange = Boolean(body?.notifyOnStatusChange);
  }

  if (body?.notifyTopicId !== undefined) {
    payload.notifyTopicId = String(body?.notifyTopicId ?? "");
  }

  return pb.collection("monitors").update(monitorId, payload);
}

export async function runMonitoringStatus(userId: string, body: any) {
  const pb = await getSuperuserPB();

  const linkId = typeof body?.linkId === "string" ? body.linkId.trim() : "";
  const jobId = typeof body?.jobId === "string" ? body.jobId.trim() : "";

  if (!linkId && !jobId) {
    return { _status: 400, error: "Missing target identifier: provide linkId or jobId" };
  }

  const targetFilter = jobId
    ? `id = "${jobId}" && userId = "${userId}"`
    : `sourcelinkId = "${linkId}" && userId = "${userId}"`;

  const existingMonitors = await pb.collection("monitors").getFullList({ filter: targetFilter });
  if (!existingMonitors || existingMonitors.length === 0) {
    return { _status: 404, error: "Monitoring job not found for this user" };
  }

  if (!config.JOBS_WEBHOOK_ENABLED) {
    return { _status: 400, error: "Jobs webhook is disabled" };
  }

  const targetMonitor = existingMonitors[0];
  const sourceLinkId = targetMonitor.sourcelinkId || targetMonitor.linkId;

  const webhookUrl = `${config.JOBS_URL}/webhook/statusMonitoringRunner${
    sourceLinkId ? `?linkId=${encodeURIComponent(sourceLinkId)}` : ""
  }`;
  const webhookResponse = await fetch(webhookUrl, {
    ...(webhookUrl.startsWith("https://")
      ? { tls: { rejectUnauthorized: false } }
      : {}),
  } as any);
  const webhookContentType = webhookResponse.headers.get("content-type") || "";
  const webhookData = webhookContentType.includes("application/json")
    ? await webhookResponse.json()
    : await webhookResponse.text();

  const refreshedMonitors = await pb
    .collection("monitors")
    .getFullList({ filter: `id = "${targetMonitor.id}" && userId = "${userId}"` });
  const refreshedMonitor = refreshedMonitors[0] || targetMonitor;
  const statusSummary = getLatestMonitorStatus(refreshedMonitor);

  const runnerDetails = typeof webhookData === "object" && webhookData
    ? (webhookData as any)?.result?.details
    : undefined;
  const matchingRunnerDetail = Array.isArray(runnerDetails)
    ? runnerDetails.find((entry: any) => entry?.jobId === refreshedMonitor.id) || runnerDetails[0]
    : undefined;

  const normalizedStatus = normalizeStatus(statusSummary.status);
  const statusForUi =
    normalizedStatus === "healthy"
      ? "up"
      : normalizedStatus === "disabled"
        ? "disabled"
        : "down";

  return {
    jobId: refreshedMonitor.id,
    linkId: sourceLinkId,
    status: statusForUi,
    rawStatus: normalizedStatus,
    endpoint: refreshedMonitor.endpoint,
    checkedAt: new Date().toISOString(),
    dateChanged: statusSummary.dateChanged,
    durationChanged: statusSummary.durationChanged,
    httpStatus: matchingRunnerDetail?.httpStatus,
    method: matchingRunnerDetail?.method,
    result: matchingRunnerDetail,
    webhookResult: webhookData,
  };
}
