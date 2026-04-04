import type { ActionAuth } from "@dashwise/sdk/data/auth";
import { api } from "@/lib/apiClient";

type PageConfigConfig = Record<string, any>;

export async function getPageConfigAction(auth: ActionAuth, pageName: string | undefined) {
  return api.pageConfig.getPageConfigAction({ auth, pageName });
}

export async function getUserPagesAction(auth: ActionAuth) {
  return api.pageConfig.getUserPagesAction(auth);
}

export async function updatePageConfigAction(auth: ActionAuth, pageName: string | undefined, config: PageConfigConfig) {
  return api.pageConfig.updatePageConfigAction({ auth, pageName, config });
}

export async function createHomePageAction(auth: ActionAuth) {
  return api.pageConfig.createHomePageAction({ auth });
}
