import type { ActionAuth } from "@dashwise/sdk/data/auth";
import { callAction } from "@/src/lib/action-client";

type PageConfigConfig = Record<string, any>;

export async function getPageConfigAction(auth: ActionAuth, pageName: string | undefined) {
  return callAction("pageConfigs", "getPageConfigAction", [auth, pageName]);
}

export async function getUserPagesAction(auth: ActionAuth) {
  return callAction("pageConfigs", "getUserPagesAction", [auth]);
}

export async function updatePageConfigAction(
  auth: ActionAuth,
  pageName: string | undefined,
  config: PageConfigConfig
) {
  return callAction("pageConfigs", "updatePageConfigAction", [auth, pageName, config]);
}
