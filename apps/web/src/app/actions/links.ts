import type { ActionAuth } from "@dashwise/sdk/data/auth";
import { callApiAction } from "@/lib/apiClient";

export async function getLinksCollectionsAction(auth: ActionAuth) {
  return callApiAction("links", "getLinksCollectionsAction", auth);
}

export async function createLinksCollectionAction(auth: ActionAuth, data: { name: string; description?: string; icon?: string }) {
  return callApiAction("links", "createLinksCollectionAction", { auth, ...data });
}

export async function updateLinksCollectionAction(auth: ActionAuth, collectionId: string, data: { name: string; description?: string; icon?: string }) {
  return callApiAction("links", "updateLinksCollectionAction", { auth, collectionId, data });
}

export async function createLinksTagAction(auth: ActionAuth, data: { name: string; color?: string }) {
  return callApiAction("links", "createLinksTagAction", { auth, ...data });
}

export async function updateLinksTagAction(auth: ActionAuth, tagId: string, data: { name: string; color?: string }) {
  return callApiAction("links", "updateLinksTagAction", { auth, tagId, data });
}

export async function getHomeLinkGroupsAction(auth: ActionAuth) {
  return callApiAction("links", "getHomeLinkGroupsAction", auth);
}

export async function createHomeLinkGroupAction(auth: ActionAuth, name: string) {
  return callApiAction("links", "createHomeLinkGroupAction", { auth, name });
}

export async function updateHomeLinkFolderIconAction(auth: ActionAuth, folderId: string, data: { icon?: string }) {
  return callApiAction("links", "updateHomeLinkFolderIconAction", { auth, folderId, data });
}

export async function getHomeLinksAction(auth: ActionAuth) {
  return callApiAction("links", "getHomeLinksAction", auth);
}

export async function getLinksFoldersAction(auth: ActionAuth, listId: string) {
  return callApiAction("links", "getLinksFoldersAction", { auth, listId });
}

export async function getLinksItemsAction(auth: ActionAuth, listId: string, folderId?: string) {
  return callApiAction("links", "getLinksItemsAction", { auth, listId, folderId });
}

export async function getLinksTagsAction(auth: ActionAuth) {
  return callApiAction("links", "getLinksTagsAction", auth);
}

export async function createLinkItemAction(auth: ActionAuth, data: { url: string; title: string; iconUrl?: string; description?: string; linkGroup?: string; folder?: string; collection?: string; tags?: string[] }) {
  return callApiAction("links", "createLinkItemAction", { auth, data });
}

export async function updateHomeLinkItemAction(auth: ActionAuth, linkId: string, data: { url?: string; title?: string; iconUrl?: string; description?: string; linkGroup?: string; folder?: string }) {
  return callApiAction("links", "updateHomeLinkItemAction", { auth, linkId, data });
}

export async function deleteLinkItemAction(auth: ActionAuth, linkId: string) {
  return callApiAction("links", "deleteLinkItemAction", { auth, linkId });
}
