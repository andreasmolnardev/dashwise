import type { ActionAuth } from "@dashwise/types/sdk/data/auth";
import { callApiAction } from "@/lib/apiClient";

export async function getUserWidgetsAction(auth: ActionAuth) {
  return callApiAction("widgets", "getUserWidgetsAction", auth);
}

export async function getUserGlanceableAction(auth: ActionAuth) {
  return callApiAction("glanceables", "getUserGlanceablesAction", auth);
}

export async function getUserGlanceablesAction(auth: ActionAuth) {
  return callApiAction("glanceables", "getUserGlanceablesAction", auth);
}

export async function getIntegrationWithGlanceableAction(auth: ActionAuth, glanceableType: string) {
  return callApiAction("glanceables", "getIntegrationWithGlanceableAction", { auth, glanceableType });
}
