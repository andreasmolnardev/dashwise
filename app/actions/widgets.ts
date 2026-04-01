"use server";

import { ActionAuth, requireUserAuth } from "@dashwise/sdk/data/auth";
import { getUserGlanceables, getUserWidgets } from "@dashwise/sdk/data/widgets";

export async function getUserWidgetsAction(auth: ActionAuth) {
  const { userId } = await requireUserAuth(auth);
  return getUserWidgets(userId);
}

export async function getUserGlanceablesAction(auth: ActionAuth) {
  const { userId } = await requireUserAuth(auth);
  return getUserGlanceables(userId);
}
