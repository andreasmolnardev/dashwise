"use server";

import { ActionAuth, requireUserAuth } from "@dashwise/sdk/data/auth";
import { getSearchItems } from "@dashwise/sdk/data/searchItems";

export async function getSearchItemsAction(auth: ActionAuth) {
  const { userId } = await requireUserAuth(auth);
  return getSearchItems(userId);
}
