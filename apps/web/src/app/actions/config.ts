import type { ActionAuth } from "@dashwise/sdk/data/auth";
import { trpc } from "@/lib/apiClient";
const api = trpc as any;

export async function getUserConfigAction(auth: ActionAuth, pageName?: string) {
  return api.config.getUserConfigAction.query({ auth, pageName });
}

export async function appendConfigArrayItemAction(auth: ActionAuth, path: string, newItem: any, pageName?: string) {
  return api.config.appendConfigArrayItemAction.mutate({ auth, path, newItem, pageName });
}

export async function updateConfigPathAction(auth: ActionAuth, path: string, updatedItem: any, pageName?: string) {
  return api.config.updateConfigPathAction.mutate({ auth, path, updatedItem, pageName });
}

export async function replaceUserConfigAction(auth: ActionAuth, nextConfig: Record<string, any>, pageName?: string) {
  return api.config.replaceUserConfigAction.mutate({ auth, nextConfig, pageName });
}

export async function deleteUnusedLinkgroupsAction(auth: ActionAuth) {
  return api.config.deleteUnusedLinkgroupsAction.mutate(auth);
}

export async function moveConfigArrayItemsAction(auth: ActionAuth, path: string, src: number, dst: number) {
  return api.config.moveConfigArrayItemsAction.mutate({ auth, path, src, dst });
}

export async function migrateLegacyPageConfigAction(auth: ActionAuth) {
  return api.config.migrateLegacyPageConfigAction.mutate(auth);
}
