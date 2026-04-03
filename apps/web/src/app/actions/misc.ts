import type { ActionAuth } from "@dashwise/sdk/data/auth";
import { callAction } from "@/src/lib/action-client";

export async function getLocationsAction(auth: ActionAuth, q?: string | null) {
  return callAction("misc", "getLocationsAction", [auth, q]);
}

export async function runPullIconsAction(auth: ActionAuth) {
  return callAction("misc", "runPullIconsAction", [auth]);
}
