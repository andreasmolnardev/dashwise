import type { ActionAuth } from "@dashwise/types/sdk/data/auth";
export type { MonitorRecord } from "@dashwise/types/sdk/data/monitoring";
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

export async function updateMonitorAction(
  auth: ActionAuth,
  monitorId: string,
  data: Record<string, unknown>,
): Promise<MonitorRecord | null> {
  return callApiAction("monitoring", "updateMonitorAction", { auth, monitorId, data }) as Promise<MonitorRecord | null>;
}

export async function createMonitorAction(
  auth: ActionAuth,
  data: {
    resourceType?: "link" | "system";
    linkId: string;
    endpoint: string;
    method?: string;
    endpointAuth?: unknown;
    responseUpFilter?: {
      acceptStatusCodes?: string;
      acceptBodyProperties?: unknown;
    };
  },
): Promise<MonitorRecord> {
  return callApiAction("monitoring", "createMonitorAction", { auth, ...data }) as Promise<MonitorRecord>;
}

export async function deleteMonitorAction(auth: ActionAuth, monitorId: string): Promise<void> {
  return callApiAction("monitoring", "deleteMonitorAction", { auth, monitorId });
}
