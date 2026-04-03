import type { ActionAuth } from "@dashwise/sdk/data/auth";
import { trpc } from "@/lib/apiClient";
const api = trpc as any;

export async function getUserWidgetsAction(auth: ActionAuth) {
  return api.widgets.getUserWidgetsAction.query(auth);
}

export async function getUserGlanceableAction(auth: ActionAuth) {
  return api.widgets.getUserGlanceableAction.query(auth);
}

export async function getUserGlanceablesAction(auth: ActionAuth) {
  return api.widgets.getUserGlanceablesAction.query(auth);
}
