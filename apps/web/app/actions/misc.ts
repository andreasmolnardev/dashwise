"use server";

import { ActionAuth, requireUserAuth } from "@dashwise/sdk/data/auth";
import { runPullIcons } from "@dashwise/sdk/data/jobs";
import { getLocations } from "@dashwise/sdk/data/misc";

export async function getLocationsAction(auth: ActionAuth, q?: string | null) {
  await requireUserAuth(auth);
  return getLocations(q);
}

export async function runPullIconsAction(auth: ActionAuth) {
  await requireUserAuth(auth);
  return runPullIcons();
}
