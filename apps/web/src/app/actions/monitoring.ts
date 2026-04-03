import type { ActionAuth } from "@dashwise/sdk/data/auth";
import { trpc } from "@/lib/apiClient";
const api = trpc as any;

export async function getMonitoringStatusAction(auth: ActionAuth, jobId?: string | null) {
  return api.monitoring.getMonitoringStatusAction.query({ auth, jobId });
}

export async function updateMonitoringStatusAction(auth: ActionAuth, body: any) {
  return api.monitoring.updateMonitoringStatusAction.mutate({ auth, body });
}
