import type { ActionAuth } from "@dashwise/sdk/data/auth";
import { trpc } from "@/lib/apiClient";
const api = trpc as any;

type PageConfigConfig = Record<string, any>;

export async function getPageConfigAction(auth: ActionAuth, pageName: string | undefined) {
  return api.pageConfig.getPageConfigAction.query({ auth, pageName });
}

export async function getUserPagesAction(auth: ActionAuth) {
  return api.pageConfig.getUserPagesAction.query(auth);
}

export async function updatePageConfigAction(auth: ActionAuth, pageName: string | undefined, config: PageConfigConfig) {
  return api.pageConfig.updatePageConfigAction.mutate({ auth, pageName, config });
}
