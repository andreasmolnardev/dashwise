"use server";

import { ActionAuth, requireUserAuth } from "@/lib/api/data/auth";
import { getAppConfig, getAppInfo } from "@/lib/api/data/app";

export async function getAppConfigAction() {
  return getAppConfig();
}

export async function getAppInfoAction(auth: ActionAuth) {
  await requireUserAuth(auth);
  return getAppInfo();
}
