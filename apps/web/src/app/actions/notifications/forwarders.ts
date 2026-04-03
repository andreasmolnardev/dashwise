import type { ActionAuth } from "@dashwise/sdk/data/auth";
import { callAction } from "@/src/lib/action-client";

export async function getForwardersAction(auth: ActionAuth) {
  return callAction("notifications/forwarders", "getForwardersAction", [auth]);
}

export async function createForwarderAction(auth: ActionAuth, body: any) {
  return callAction("notifications/forwarders", "createForwarderAction", [auth, body]);
}

export async function updateForwarderAction(auth: ActionAuth, body: any) {
  return callAction("notifications/forwarders", "updateForwarderAction", [auth, body]);
}

export async function deleteForwarderAction(auth: ActionAuth, forwarderId: string) {
  return callAction("notifications/forwarders", "deleteForwarderAction", [auth, forwarderId]);
}
