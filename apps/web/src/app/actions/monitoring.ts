import type { ActionAuth } from "@dashwise/sdk/data/auth";
import { api } from "@/lib/apiClient";

export async function getMonitoringStatusAction(auth: ActionAuth, jobId?: string | null) {
  return api.monitoring.getMonitoringStatusAction({ auth, jobId });
}

export async function updateMonitoringStatusAction(auth: ActionAuth, body: any) {
  return api.monitoring.updateMonitoringStatusAction({ auth, body });
}
