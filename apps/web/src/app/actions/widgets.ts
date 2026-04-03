import type { ActionAuth } from "@dashwise/sdk/data/auth";
import { callAction } from "@/src/lib/action-client";

export async function getUserWidgetsAction(auth: ActionAuth) {
  return callAction("widgets", "getUserWidgetsAction", [auth]);
}

export async function getUserGlanceableAction(auth: ActionAuth) {
  return callAction("widgets", "getUserGlanceableAction", [auth]);
}

export async function getUserGlanceablesAction(auth: ActionAuth) {
  return callAction("widgets", "getUserGlanceablesAction", [auth]);
}
