import type { ActionAuth } from "@dashwise/sdk/data/auth";
import { api } from "@/lib/apiClient";

export async function getForwardersAction(auth: ActionAuth) {
  return api.notifications.forwarders.getForwardersAction(auth);
}

export async function createForwarderAction(auth: ActionAuth, body: any) {
  return api.notifications.forwarders.createForwarderAction({ auth, body });
}

export async function updateForwarderAction(auth: ActionAuth, body: any) {
  return api.notifications.forwarders.updateForwarderAction({ auth, body });
}

export async function deleteForwarderAction(auth: ActionAuth, forwarderId: string) {
  return api.notifications.forwarders.deleteForwarderAction({ auth, forwarderId });
}
