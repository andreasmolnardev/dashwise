import type { ActionAuth } from "@dashwise/sdk/data/auth";
import { callAction } from "@/src/lib/action-client";

export async function getUserConfigAction(auth: ActionAuth, pageName?: string) {
  return callAction("config", "getUserConfigAction", [auth, pageName]);
}

export async function appendConfigArrayItemAction(
  auth: ActionAuth,
  path: string,
  newItem: any,
  pageName?: string
) {
  return callAction("config", "appendConfigArrayItemAction", [auth, path, newItem, pageName]);
}

export async function updateConfigPathAction(
  auth: ActionAuth,
  path: string,
  updatedItem: any,
  pageName?: string
) {
  return callAction("config", "updateConfigPathAction", [auth, path, updatedItem, pageName]);
}

export async function replaceUserConfigAction(
  auth: ActionAuth,
  nextConfig: Record<string, any>,
  pageName?: string
) {
  return callAction("config", "replaceUserConfigAction", [auth, nextConfig, pageName]);
}

export async function deleteUnusedLinkgroupsAction(auth: ActionAuth) {
  return callAction("config", "deleteUnusedLinkgroupsAction", [auth]);
}

export async function moveConfigArrayItemsAction(
  auth: ActionAuth,
  path: string,
  src: number,
  dst: number
) {
  return callAction("config", "moveConfigArrayItemsAction", [auth, path, src, dst]);
}

export async function migrateLegacyPageConfigAction(auth: ActionAuth) {
  return callAction("config", "migrateLegacyPageConfigAction", [auth]);
}
