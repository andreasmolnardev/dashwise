
import { ActionAuth, requireUserAuth } from "@dashwise/sdk/data/auth";
import { getAppConfig, getAppInfo } from "@dashwise/sdk/data/app";

export async function getAppConfigAction() {
  return getAppConfig();
}

export async function getAppInfoAction(auth: ActionAuth) {
  await requireUserAuth(auth);
  return getAppInfo();
}
