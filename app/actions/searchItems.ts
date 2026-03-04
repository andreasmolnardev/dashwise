"use server";

import { ActionAuth, requireUserAuth } from "@/lib/api/data/auth";
import { getSearchItems } from "@/lib/api/data/searchItems";

export async function getSearchItemsAction(auth: ActionAuth) {
  const { userId } = await requireUserAuth(auth);
  return getSearchItems(userId);
}
