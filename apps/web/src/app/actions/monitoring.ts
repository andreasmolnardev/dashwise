import type { ActionAuth } from "@dashwise/sdk/data/auth";
import { callAction } from "@/src/lib/action-client";

export async function getMonitoringStatusAction(auth: ActionAuth, jobId?: string | null) {
  return callAction("monitoring", "getMonitoringStatusAction", [auth, jobId]);
}

export async function updateMonitoringStatusAction(auth: ActionAuth, body: any) {
  return callAction("monitoring", "updateMonitoringStatusAction", [auth, body]);
}
