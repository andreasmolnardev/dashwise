import type { ActionAuth } from "@dashwise/sdk/data/auth";
import { api } from "@/lib/apiClient";

export async function getLocationsAction(auth: ActionAuth, q?: string | null) {
  return api.misc.getLocationsAction({ auth, q });
}

export async function runPullIconsAction(auth: ActionAuth) {
  return api.jobs.runPullIconsAction(auth);
}
