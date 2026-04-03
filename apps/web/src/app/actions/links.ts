import type { ActionAuth } from "@dashwise/sdk/data/auth";
import { callAction } from "@/src/lib/action-client";

export async function getLinksCollectionsAction(auth: ActionAuth) {
  return callAction("links", "getLinksCollectionsAction", [auth]);
}

export async function getHomeLinkGroupsAction(auth: ActionAuth) {
  return callAction("links", "getHomeLinkGroupsAction", [auth]);
}

export async function createHomeLinkGroupAction(auth: ActionAuth, name: string) {
  return callAction("links", "createHomeLinkGroupAction", [auth, name]);
}


export async function getHomeLinksAction(auth: ActionAuth) {
  return callAction("links", "getHomeLinksAction", [auth]);
}

export async function getLinksFoldersAction(auth: ActionAuth, listId: string) {
  return callAction("links", "getLinksFoldersAction", [auth, listId]);
}

export async function getLinksItemsAction(auth: ActionAuth, listId: string, folderId?: string) {
  return callAction("links", "getLinksItemsAction", [auth, listId, folderId]);
}

export async function getLinksTagsAction(auth: ActionAuth) {
  return callAction("links", "getLinksTagsAction", [auth]);
}

export async function createLinkItemAction(
  auth: ActionAuth,
  data: { url: string; title: string; iconUrl?: string; description?: string; linkGroup?: string; folder?: string }
) {
  return callAction("links", "createLinkItemAction", [auth, data]);
}

export async function updateHomeLinkItemAction(
  auth: ActionAuth,
  linkId: string,
  data: { url?: string; title?: string; iconUrl?: string; description?: string; linkGroup?: string; folder?: string }
) {
  return callAction("links", "updateHomeLinkItemAction", [auth, linkId, data]);
}

export async function deleteLinkItemAction(auth: ActionAuth, linkId: string) {
  return callAction("links", "deleteLinkItemAction", [auth, linkId]);
}
