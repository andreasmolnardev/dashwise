import type { ActionAuth } from "@dashwise/sdk/data/auth";
import { trpc } from "@/lib/apiClient";
const api = trpc as any;

export async function getSearchItemsAction(auth: ActionAuth) {
  return api.searchItems.getSearchItemsAction.query(auth);
}
