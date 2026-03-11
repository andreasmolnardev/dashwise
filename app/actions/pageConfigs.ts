"use server";

import { ActionAuth, requireUserAuth } from "@dashwise/sdk/data/auth";
import { getPageConfigJSON, getUserPages, updatePageConfig } from "@dashwise/sdk/data/pageConfig";

type PageConfigPatch = Record<string, any>;

function normalizePageName(pageName?: string | null) {
  const cleaned = String(pageName ?? "home").trim().toLowerCase();
  return cleaned.length > 0 ? cleaned : "home";
}

export async function getPageConfigAction(auth: ActionAuth, pageName: string | undefined) {
  const { userId } = await requireUserAuth(auth);
  const normalizedPageName = normalizePageName(pageName);
  return getPageConfigJSON(userId, normalizedPageName, true);
}

export async function getUserPagesAction(auth: ActionAuth) {
  const { userId } = await requireUserAuth(auth);
  return getUserPages(userId);
}

export async function updatePageConfigAction(
  auth: ActionAuth,
  pageName: string | undefined,
  patch: PageConfigPatch
) {
  const { userId } = await requireUserAuth(auth);
  const normalizedPageName = normalizePageName(pageName);

  const existingConfig = (await getPageConfigJSON(userId, normalizedPageName)) ?? {};
  const nextConfig = { ...existingConfig, ...patch };

  return updatePageConfig(userId, normalizedPageName, nextConfig);
}
