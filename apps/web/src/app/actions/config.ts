import type { ActionAuth } from "@dashwise/sdk/data/auth";
import { api } from "@/lib/apiClient";

export async function getUserConfigAction(auth: ActionAuth, pageName?: string) {
  return api.config.getUserConfigAction({ auth, pageName });
}

export async function appendConfigArrayItemAction(auth: ActionAuth, path: string, newItem: any, pageName?: string) {
  return api.config.appendConfigArrayItemAction({ auth, path, newItem, pageName });
}

export async function updateConfigPathAction(auth: ActionAuth, path: string, updatedItem: any, pageName?: string) {
  return api.config.updateConfigPathAction({ auth, path, updatedItem, pageName });
}

export async function replaceUserConfigAction(auth: ActionAuth, nextConfig: Record<string, any>, pageName?: string) {
  return api.config.replaceUserConfigAction({ auth, nextConfig, pageName });
}

export async function deleteUnusedLinkgroupsAction(auth: ActionAuth) {
  return api.config.deleteUnusedLinkgroupsAction(auth);
}

export async function moveConfigArrayItemsAction(auth: ActionAuth, path: string, src: number, dst: number) {
  return api.config.moveConfigArrayItemsAction({ auth, path, src, dst });
}

export async function migrateLegacyPageConfigAction(auth: ActionAuth) {
  return api.config.migrateLegacyPageConfigAction(auth);
}
