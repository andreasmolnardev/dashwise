import type { ActionAuth } from "@dashwise/sdk/data/auth";
import { api } from "@/lib/apiClient";

export async function getUserWidgetsAction(auth: ActionAuth) {
  return api.widgets.getUserWidgetsAction(auth);
}

export async function getUserGlanceableAction(auth: ActionAuth) {
  return api.glanceables.getUserGlanceablesAction(auth);
}

export async function getUserGlanceablesAction(auth: ActionAuth) {
  return api.glanceables.getUserGlanceablesAction(auth);
}

export async function getIntegrationWithGlanceableAction(auth: ActionAuth, glanceableType: string) {
  return api.glanceables.getIntegrationWithGlanceableAction({ auth, glanceableType });
}
