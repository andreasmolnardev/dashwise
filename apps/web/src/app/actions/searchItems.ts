import type { ActionAuth } from "@dashwise/types/sdk/data/auth";
import { callApiAction } from "@/lib/apiClient";

export async function getSearchItemsAction(auth: ActionAuth) {
  return callApiAction("searchItems", "getSearchItemsAction", auth);
}

export async function getFrequentlyUsedSearchItemsAction(auth: ActionAuth) {
  return callApiAction("searchItems", "getFrequentlyUsedAction", auth);
}

export async function logSearchItemUsageAction(auth: ActionAuth, id: string, timestamp: string) {
  return callApiAction("searchItems", "logSearchItemUsageAction", { auth, id, timestamp });
}
