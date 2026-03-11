"use server"

import { ActionAuth, requireUserAuth } from "@dashwise/sdk/data/auth";
import { 
  createHomeLinkGroup,
  createHomeLinkItem,
  getHomeLinkGroups,
  getLinksCollections,
  getLinksFolders, 
  getLinksItems, 
  getLinksTags,
  getHomeLinks,
  updateHomeLinkItem
} from "@/dashwise-sdk/data/links";

export async function getLinksCollectionsAction(auth: ActionAuth) {
  const { userId } = await requireUserAuth(auth);
  return getLinksCollections(userId);
}

export async function getHomeLinkGroupsAction(auth: ActionAuth) {
  const { userId } = await requireUserAuth(auth);
  return getHomeLinkGroups(userId);
}

export async function createHomeLinkGroupAction(auth: ActionAuth, name: string) {
  const { userId } = await requireUserAuth(auth);
  return createHomeLinkGroup(userId, name);
}


export async function getHomeLinksAction(auth: ActionAuth) {
  const { userId } = await requireUserAuth(auth);
  return getHomeLinks(userId);
}

export async function getLinksFoldersAction(auth: ActionAuth, listId: string) {
  await requireUserAuth(auth);
  return getLinksFolders(listId);
}

export async function getLinksItemsAction(auth: ActionAuth, listId: string, folderId?: string) {
  await requireUserAuth(auth);
  return getLinksItems(listId, folderId);
}

export async function getLinksTagsAction(auth: ActionAuth) {
  await requireUserAuth(auth);
  return getLinksTags();
}

export async function createLinkItemAction(
  auth: ActionAuth,
  data: { url: string; title: string; iconUrl?: string; description?: string; linkGroup?: string; folder?: string }
) {
  const { userId } = await requireUserAuth(auth);
  return createHomeLinkItem(userId, data);
}

export async function updateHomeLinkItemAction(
  auth: ActionAuth,
  linkId: string,
  data: { url?: string; title?: string; iconUrl?: string; description?: string; linkGroup?: string; folder?: string }
) {
  const { userId } = await requireUserAuth(auth);
  // Assuming there's an update function in the SDK similar to createHomeLinkItem
  return updateHomeLinkItem(userId, linkId, data);
}
