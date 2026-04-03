"use server";

import { ActionAuth, requireUserAuth } from "@dashwise/sdk/data/auth";
import {
  appendConfigArrayItem,
  deleteUnusedLinkgroups,
  getUserConfig,
  migrateLegacyPageConfig,
  moveConfigArrayItems,
  patchConfigPath,
  replaceUserConfig,
} from "@dashwise/sdk/data/config";

export async function getUserConfigAction(auth: ActionAuth, pageName?: string) {
  const { userId } = await requireUserAuth(auth);
  return getUserConfig(userId, pageName);
}

export async function appendConfigArrayItemAction(
  auth: ActionAuth,
  path: string,
  newItem: any,
  pageName?: string
) {
  const { userId } = await requireUserAuth(auth);
  return appendConfigArrayItem(userId, path, newItem, pageName);
}

export async function updateConfigPathAction(
  auth: ActionAuth,
  path: string,
  updatedItem: any,
  pageName?: string
) {
  const { userId } = await requireUserAuth(auth);
  return patchConfigPath(userId, path, updatedItem, pageName);
}

export async function replaceUserConfigAction(
  auth: ActionAuth,
  nextConfig: Record<string, any>,
  pageName?: string
) {
  const { userId } = await requireUserAuth(auth);
  return replaceUserConfig(userId, nextConfig, pageName);
}

export async function deleteUnusedLinkgroupsAction(auth: ActionAuth) {
  const { userId } = await requireUserAuth(auth);
  return deleteUnusedLinkgroups(userId);
}

export async function moveConfigArrayItemsAction(
  auth: ActionAuth,
  path: string,
  src: number,
  dst: number
) {
  const { userId } = await requireUserAuth(auth);
  return moveConfigArrayItems(userId, path, src, dst);
}

export async function migrateLegacyPageConfigAction(auth: ActionAuth) {
  const { userId } = await requireUserAuth(auth);
  return migrateLegacyPageConfig(userId);
}
