import type { ActionAuth } from "@dashwise/sdk/data/auth";
import { trpc } from "@/lib/apiClient";
const api = trpc as any;

export async function getLinksCollectionsAction(auth: ActionAuth) {
  return api.links.getLinksCollectionsAction.query(auth);
}

export async function getHomeLinkGroupsAction(auth: ActionAuth) {
  return api.links.getHomeLinkGroupsAction.query(auth);
}

export async function createHomeLinkGroupAction(auth: ActionAuth, name: string) {
  return api.links.createHomeLinkGroupAction.mutate({ auth, name });
}

export async function getHomeLinksAction(auth: ActionAuth) {
  return api.links.getHomeLinksAction.query(auth);
}

export async function getLinksFoldersAction(auth: ActionAuth, listId: string) {
  return api.links.getLinksFoldersAction.query({ auth, listId });
}

export async function getLinksItemsAction(auth: ActionAuth, listId: string, folderId?: string) {
  return api.links.getLinksItemsAction.query({ auth, listId, folderId });
}

export async function getLinksTagsAction(auth: ActionAuth) {
  return api.links.getLinksTagsAction.query(auth);
}

export async function createLinkItemAction(auth: ActionAuth, data: { url: string; title: string; iconUrl?: string; description?: string; linkGroup?: string; folder?: string }) {
  return api.links.createLinkItemAction.mutate({ auth, data });
}

export async function updateHomeLinkItemAction(auth: ActionAuth, linkId: string, data: { url?: string; title?: string; iconUrl?: string; description?: string; linkGroup?: string; folder?: string }) {
  return api.links.updateHomeLinkItemAction.mutate({ auth, linkId, data });
}

export async function deleteLinkItemAction(auth: ActionAuth, linkId: string) {
  return api.links.deleteLinkItemAction.mutate({ auth, linkId });
}
