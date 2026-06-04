import type { ActionAuth } from "@dashwise/types/sdk/data/auth";
import { callApiAction } from "@/lib/apiClient";

export async function getLocationsAction(auth: ActionAuth, q?: string | null) {
  return callApiAction("misc", "getLocationsAction", { auth, q });
}

export async function runPullIconsAction(auth: ActionAuth) {
  return callApiAction("jobs", "runPullIconsAction", auth);
}
