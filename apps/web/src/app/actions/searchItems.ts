import type { ActionAuth } from "@dashwise/sdk/data/auth";
import { callAction } from "@/src/lib/action-client";

export async function getSearchItemsAction(auth: ActionAuth) {
  return callAction("searchItems", "getSearchItemsAction", [auth]);
}
