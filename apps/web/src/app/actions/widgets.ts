import type { ActionAuth } from "@dashwise/sdk/data/auth";
import { api } from "@/lib/apiClient";

export async function getUserWidgetsAction(auth: ActionAuth) {
  return api.widgets.getUserWidgetsAction(auth);
}

export async function getUserGlanceableAction(auth: ActionAuth) {
  return api.widgets.getUserGlanceableAction(auth);
}

export async function getUserGlanceablesAction(auth: ActionAuth) {
  return api.widgets.getUserGlanceablesAction(auth);
}
