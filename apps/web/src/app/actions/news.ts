import type { ActionAuth } from "@dashwise/sdk/data/auth";
import { api } from "@/lib/apiClient";

export async function getNewsFeedAction(auth: ActionAuth, category?: string | null) {
  return api.news.getNewsFeedAction({ auth, category });
}

export async function getNewsSubscriptionsAction(auth: ActionAuth) {
  return api.news.getNewsSubscriptionsAction(auth);
}

export async function refreshNewsFeedAction(auth: ActionAuth) {
  return api.news.refreshNewsFeedAction(auth);
}

export async function subscribeNewsFeedAction(auth: ActionAuth, sub: { feedUrl: string; name?: string; icon?: string; category?: string }) {
  return api.news.subscribeNewsFeedAction({ auth, sub });
}

export async function unsubscribeNewsFeedAction(auth: ActionAuth, feedUrl: string) {
  return api.news.unsubscribeNewsFeedAction({ auth, feedUrl });
}

export async function updateNewsFeedAction(auth: ActionAuth, payload: { oldFeedUrl: string; feedUrl: string; name: string; icon: string; category: string }) {
  return api.news.updateNewsFeedAction({ auth, payload });
}
