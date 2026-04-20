import config from "../lib/config";
import { getSuperuserPB } from "@dashwise/sdk/lib/pocketbase";

type MonitorPing = {
  status?: string;
  created?: string;
  dateChanged?: string;
  httpStatus?: number;
  method?: string;
  endpoint?: string;
  [key: string]: unknown;
};

export interface MonitorRecord {
  id: string;
  endpoint?: string;
  status?: string;
  source?: string;
  linkId?: string;
  pings?: MonitorPing[] | string;
  created?: string;
  updated?: string;
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
    const key = monitor.linkId || monitor.source || monitor.id;
    results[key] = {
      status: statusSummary.status,
      dateChanged: statusSummary.dateChanged,
      durationChanged: statusSummary.durationChanged,
      endpoint: monitor.endpoint,
    };
  }

  return results;
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
    : `source = "link ${linkId}" && userId = "${userId}"`;

  const existingMonitors = await pb.collection("monitors").getFullList({ filter: targetFilter });
  if (!existingMonitors || existingMonitors.length === 0) {
    return { _status: 404, error: "Monitoring job not found for this user" };
  }

  if (!config.jobs_webhook_enabled) {
    return { _status: 400, error: "Jobs webhook is disabled" };
  }

  const targetMonitor = existingMonitors[0];
  const source = String(targetMonitor.source || (linkId ? `link ${linkId}` : ""));
  const sourceLinkId = source.startsWith("link ") ? source.slice(5) : undefined;

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
    source,
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
