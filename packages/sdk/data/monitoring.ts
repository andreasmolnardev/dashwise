import config from "../lib/config";
import { getSuperuserPB } from "@dashwise/sdk/lib/pocketbase";
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
  const rawType = process.env.MONITORING_OUTLIER_THRESHOLD_TYPE;
  const rawValue = process.env.MONITORING_OUTLIER_THRESHOLD_VALUE;
  const type = rawType === "absolute" ? "absolute" : "relative";
  const parsedValue = Number(rawValue);
  const fallbackValue = type === "absolute" ? 500 : 50;
  const value = Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallbackValue;
  return { type, value };
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
    { status: string; dateChanged: string | null; durationChanged: number | null; endpoint?: string }
  > = {};

  for (const monitor of monitors) {
    const statusSummary = getLatestMonitorStatus(monitor);
    const key = monitor.sourcelinkId || monitor.linkId || monitor.id;
    results[key] = {
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

  if (!config.jobs_webhook_enabled) {
    return { _status: 400, error: "Jobs webhook is disabled" };
  }

  const targetMonitor = existingMonitors[0];
  const sourceLinkId = targetMonitor.sourcelinkId || targetMonitor.linkId;

  const webhookUrl = `${config.jobs_url}/webhook/statusMonitoringRunner${
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
