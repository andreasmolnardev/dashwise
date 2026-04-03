import type { ActionAuth } from "@dashwise/sdk/data/auth";
import { trpc } from "@/lib/apiClient";
const api = trpc as any;

export async function getForwardersAction(auth: ActionAuth) {
  return api.notifications.forwarders.getForwardersAction.query(auth);
}

export async function createForwarderAction(auth: ActionAuth, body: any) {
  return api.notifications.forwarders.createForwarderAction.mutate({ auth, body });
}

export async function updateForwarderAction(auth: ActionAuth, body: any) {
  return api.notifications.forwarders.updateForwarderAction.mutate({ auth, body });
}

export async function deleteForwarderAction(auth: ActionAuth, forwarderId: string) {
  return api.notifications.forwarders.deleteForwarderAction.mutate({ auth, forwarderId });
}
