import type { ActionAuth } from "@dashwise/sdk/data/auth";
import { api } from "@/lib/apiClient";

export async function getLinksCollectionsAction(auth: ActionAuth) {
  return api.links.getLinksCollectionsAction(auth);
}

export async function getHomeLinkGroupsAction(auth: ActionAuth) {
  return api.links.getHomeLinkGroupsAction(auth);
}

export async function createHomeLinkGroupAction(auth: ActionAuth, name: string) {
  return api.links.createHomeLinkGroupAction({ auth, name });
}

export async function getHomeLinksAction(auth: ActionAuth) {
  return api.links.getHomeLinksAction(auth);
}

export async function getLinksFoldersAction(auth: ActionAuth, listId: string) {
  return api.links.getLinksFoldersAction({ auth, listId });
}

export async function getLinksItemsAction(auth: ActionAuth, listId: string, folderId?: string) {
  return api.links.getLinksItemsAction({ auth, listId, folderId });
}

export async function getLinksTagsAction(auth: ActionAuth) {
  return api.links.getLinksTagsAction(auth);
}

export async function createLinkItemAction(auth: ActionAuth, data: { url: string; title: string; iconUrl?: string; description?: string; linkGroup?: string; folder?: string }) {
  return api.links.createLinkItemAction({ auth, data });
}

export async function updateHomeLinkItemAction(auth: ActionAuth, linkId: string, data: { url?: string; title?: string; iconUrl?: string; description?: string; linkGroup?: string; folder?: string }) {
  return api.links.updateHomeLinkItemAction({ auth, linkId, data });
}

export async function deleteLinkItemAction(auth: ActionAuth, linkId: string) {
  return api.links.deleteLinkItemAction({ auth, linkId });
}
