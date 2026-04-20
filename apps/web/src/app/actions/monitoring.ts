import type { ActionAuth } from "@dashwise/sdk/data/auth";
import type { MonitorRecord } from "@dashwise/sdk/data/monitoring";
import { callApiAction } from "@/lib/apiClient";

export async function getMonitoringStatusAction(auth: ActionAuth, jobId?: string | null) {
  return callApiAction("monitoring", "getMonitoringStatusAction", { auth, jobId });
}

export async function updateMonitoringStatusAction(auth: ActionAuth, body: any) {
  return callApiAction("monitoring", "updateMonitoringStatusAction", { auth, body });
}

export async function getMonitorsAction(auth: ActionAuth): Promise<MonitorRecord[]> {
  return callApiAction("monitoring", "getMonitorsAction", { auth }) as Promise<MonitorRecord[]>;
}

export async function getMonitorAction(auth: ActionAuth, monitorId: string): Promise<MonitorRecord | null> {
  return callApiAction("monitoring", "getMonitorAction", { auth, monitorId }) as Promise<MonitorRecord | null>;
}
