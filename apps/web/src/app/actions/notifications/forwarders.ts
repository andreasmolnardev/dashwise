import type { ActionAuth } from "@dashwise/sdk/data/auth";
import { callApiAction } from "@/lib/apiClient";

export async function getForwardersAction(auth: ActionAuth) {
  return callApiAction("notifications.forwarders", "getForwardersAction", auth);
}

export async function createForwarderAction(auth: ActionAuth, body: any) {
  return callApiAction("notifications.forwarders", "createForwarderAction", { auth, body });
}

export async function updateForwarderAction(auth: ActionAuth, body: any) {
  return callApiAction("notifications.forwarders", "updateForwarderAction", { auth, body });
}

export async function deleteForwarderAction(auth: ActionAuth, forwarderId: string) {
  return callApiAction("notifications.forwarders", "deleteForwarderAction", { auth, forwarderId });
}
