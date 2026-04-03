import type { ActionAuth } from "@dashwise/sdk/data/auth";
import { callAction } from "@/src/lib/action-client";

export async function getAppConfigAction() {
  return callAction("app", "getAppConfigAction");
}

export async function getAppInfoAction(auth: ActionAuth) {
  return callAction("app", "getAppInfoAction", [auth]);
}
