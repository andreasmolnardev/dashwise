import type { ActionAuth } from "@dashwise/sdk/data/auth";
import { api } from "@/lib/apiClient";

export async function getSearchItemsAction(auth: ActionAuth) {
  return api.searchItems.getSearchItemsAction(auth);
}
