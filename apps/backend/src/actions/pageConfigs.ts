
import { ActionAuth, requireUserAuth } from "@dashwise/sdk/data/auth";
import { getPageConfigJSON, getUserPages, updatePageConfig } from "@dashwise/sdk/data/pageConfig";

type PageConfigConfig = Record<string, any>;

function normalizePageName(pageName?: string | null) {
  const cleaned = String(pageName ?? "home").trim().toLowerCase();
  return cleaned.length > 0 ? cleaned : "home";
}

export async function getPageConfigAction(auth: ActionAuth, pageName: string | undefined) {
  const { userId } = await requireUserAuth(auth);
  const normalizedPageName = normalizePageName(pageName);
  return getPageConfigJSON(userId, normalizedPageName);
}

export async function getUserPagesAction(auth: ActionAuth) {
  const { userId } = await requireUserAuth(auth);
  return getUserPages(userId);
}

export async function updatePageConfigAction(
  auth: ActionAuth,
  pageName: string | undefined,
  config: PageConfigConfig
) {
  const { userId } = await requireUserAuth(auth);
  const normalizedPageName = normalizePageName(pageName);

  return updatePageConfig(userId, normalizedPageName, config);
}
