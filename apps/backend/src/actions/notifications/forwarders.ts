
import { ActionAuth, requireUserAuth } from "@dashwise/sdk/data/auth";
import {
  createForwarder,
  deleteForwarder,
  getForwarders,
  updateForwarder,
} from "@dashwise/sdk/data/notifications/forwarders";

export async function getForwardersAction(auth: ActionAuth) {
  const { userId } = await requireUserAuth(auth);
  return getForwarders(userId);
}

export async function createForwarderAction(auth: ActionAuth, body: any) {
  const { userId } = await requireUserAuth(auth);
  return createForwarder(userId, body);
}

export async function updateForwarderAction(auth: ActionAuth, body: any) {
  const { userId } = await requireUserAuth(auth);
  return updateForwarder(userId, body);
}

export async function deleteForwarderAction(auth: ActionAuth, forwarderId: string) {
  const { userId } = await requireUserAuth(auth);
  return deleteForwarder(userId, forwarderId);
}
