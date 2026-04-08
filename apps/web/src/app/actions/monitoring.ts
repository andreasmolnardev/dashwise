import type { ActionAuth } from "@dashwise/sdk/data/auth";
import { callApiAction } from "@/lib/apiClient";

export async function getMonitoringStatusAction(auth: ActionAuth, jobId?: string | null) {
  return callApiAction("monitoring", "getMonitoringStatusAction", { auth, jobId });
}

export async function updateMonitoringStatusAction(auth: ActionAuth, body: any) {
  return callApiAction("monitoring", "updateMonitoringStatusAction", { auth, body });
}
