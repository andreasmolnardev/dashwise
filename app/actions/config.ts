"use server";

import { ActionAuth, requireUserAuth } from "@/lib/api/data/auth";
import {
  appendConfigArrayItem,
  deleteUnusedLinkgroups,
  getUserConfig,
  moveConfigArrayItems,
  patchConfigPath,
  replaceUserConfig,
} from "@/lib/api/data/config";

export async function getUserConfigAction(auth: ActionAuth) {
  const { userId } = await requireUserAuth(auth);
  return getUserConfig(userId);
}

export async function appendConfigArrayItemAction(auth: ActionAuth, path: string, newItem: any) {
  const { userId } = await requireUserAuth(auth);
  return appendConfigArrayItem(userId, path, newItem);
}

export async function updateConfigPathAction(auth: ActionAuth, path: string, updatedItem: any) {
  const { userId } = await requireUserAuth(auth);
  return patchConfigPath(userId, path, updatedItem);
}

export async function replaceUserConfigAction(auth: ActionAuth, nextConfig: Record<string, any>) {
  const { userId } = await requireUserAuth(auth);
  return replaceUserConfig(userId, nextConfig);
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
