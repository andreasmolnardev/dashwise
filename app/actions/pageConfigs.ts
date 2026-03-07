"use server";

import { ActionAuth, requireUserAuth } from "@dashwise/sdk/data/auth";
import { getPageConfigJSON, updatePageConfig } from "@dashwise/sdk/data/pageConfig";

type PageConfigPatch = Record<string, any>;

function normalizePageName(pageName?: string | null) {
  const cleaned = String(pageName ?? "home").trim().toLowerCase();
  return cleaned.length > 0 ? cleaned : "home";
}

export async function updatePageConfigAction(
  auth: ActionAuth,
  pageName: string | undefined,
  patch: PageConfigPatch
) {
  const { userId } = await requireUserAuth(auth);
  const normalizedPageName = normalizePageName(pageName);

  const existingRecord = await getPageConfigJSON(userId, normalizedPageName);
  const existingConfig = existingRecord?.config ?? {};
  const nextConfig = { ...existingConfig, ...patch };

  return updatePageConfig(userId, normalizedPageName, nextConfig);
}
