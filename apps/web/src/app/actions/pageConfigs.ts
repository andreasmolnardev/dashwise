import type { ActionAuth } from "@dashwise/types/sdk/data/auth";
import type { PageConfig } from "@dashwise/types/sdk/data/pageConfig";
import { callApiAction } from "@/lib/apiClient";
import { rpcCreateHomePage, rpcGetPageConfig, rpcGetUserPages, rpcUpdatePageConfig } from "@/lib/rpcClient";

export type CreateHomePageResponse = {
  config: PageConfig;
  created: boolean;
  success: boolean;
};

export async function getPageConfigAction(auth: ActionAuth, pageName: string | undefined): Promise<PageConfig | null> {
  return callApiAction("pageConfig", "getPageConfigAction", { auth, pageName }) as Promise<PageConfig | null>;
}

export async function getUserPagesAction(auth: ActionAuth): Promise<Array<{ pageName: string }>> {
  return callApiAction("pageConfig", "getUserPagesAction", auth) as Promise<Array<{ pageName: string }>>;
}

export async function updatePageConfigAction(auth: ActionAuth, pageName: string | undefined, config: PageConfig): Promise<unknown> {
  return callApiAction("pageConfig", "updatePageConfigAction", { auth, pageName, config }) as Promise<unknown>;
}

export async function createHomePageAction(auth: ActionAuth): Promise<CreateHomePageResponse> {
  return callApiAction("pageConfig", "createHomePageAction", { auth }) as Promise<CreateHomePageResponse>;
}

export async function migrateLegacyPageConfigAction(auth: ActionAuth): Promise<unknown> {
  return callApiAction("pageConfig", "migrateLegacyAction", { auth }) as Promise<unknown>;
}

export async function getPageIntegrationDataAction(
  auth: ActionAuth,
  pageName?: string,
): Promise<unknown> {
  return callApiAction("pageConfig", "getPageIntegrationDataAction", { auth, pageName }) as Promise<unknown>;
}
