import type { ActionAuth } from "@dashwise/sdk/data/auth";
import { callApiAction } from "@/lib/apiClient";

export async function getSearchItemsAction(auth: ActionAuth) {
  return callApiAction("searchItems", "getSearchItemsAction", auth);
}
