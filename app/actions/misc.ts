"use server";

import { ActionAuth, requireUserAuth } from "@/lib/api/data/auth";
import { getLocations, runPullIcons } from "@/lib/api/data/misc";

export async function getLocationsAction(auth: ActionAuth, q?: string | null) {
  await requireUserAuth(auth);
  return getLocations(q);
}

export async function runPullIconsAction(auth: ActionAuth) {
  await requireUserAuth(auth);
  return runPullIcons();
}
