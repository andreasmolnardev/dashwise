
import { ActionAuth, requireUserAuth } from "@dashwise/sdk/data/auth";
import { getUserGlanceable, getUserWidgets } from "@dashwise/sdk/data/widgets";

export async function getUserWidgetsAction(auth: ActionAuth) {
  const { userId } = await requireUserAuth(auth);
  return getUserWidgets(userId);
}

export async function getUserGlanceableAction(auth: ActionAuth) {
  const { userId } = await requireUserAuth(auth);
  return getUserGlanceable(userId);
}

export async function getUserGlanceablesAction(auth: ActionAuth) {
  return getUserGlanceableAction(auth);
}
