import type { ActionAuth } from "@dashwise/sdk/data/auth";
import { callAction } from "@/src/lib/action-client";

export async function getNewsFeedAction(auth: ActionAuth, category?: string | null) {
  return callAction("news", "getNewsFeedAction", [auth, category]);
}

export async function getNewsSubscriptionsAction(auth: ActionAuth) {
  return callAction("news", "getNewsSubscriptionsAction", [auth]);
}

export async function refreshNewsFeedAction(auth: ActionAuth) {
  return callAction("news", "refreshNewsFeedAction", [auth]);
}

export async function subscribeNewsFeedAction(
  auth: ActionAuth,
  sub: { feedUrl: string; name?: string; icon?: string; category?: string }
) {
  return callAction("news", "subscribeNewsFeedAction", [auth, sub]);
}

export async function unsubscribeNewsFeedAction(auth: ActionAuth, feedUrl: string) {
  return callAction("news", "unsubscribeNewsFeedAction", [auth, feedUrl]);
}

export async function updateNewsFeedAction(
  auth: ActionAuth,
  payload: { oldFeedUrl: string; feedUrl: string; name: string; icon: string; category: string }
) {
  return callAction("news", "updateNewsFeedAction", [auth, payload]);
}
