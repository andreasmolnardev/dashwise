import type { ActionAuth } from "@dashwise/sdk/data/auth";
import { trpc } from "@/lib/apiClient";
const api = trpc as any;

export async function getLocationsAction(auth: ActionAuth, q?: string | null) {
  return api.misc.getLocationsAction.query({ auth, q });
}

export async function runPullIconsAction(auth: ActionAuth) {
  return api.jobs.runPullIconsAction.mutate(auth);
}
