import type { ActionAuth } from "@dashwise/sdk/data/auth";
import { trpc } from "@/lib/apiClient";
const api = trpc as any;

export async function getNewsFeedAction(auth: ActionAuth, category?: string | null) {
  return api.news.getNewsFeedAction.query({ auth, category });
}

export async function getNewsSubscriptionsAction(auth: ActionAuth) {
  return api.news.getNewsSubscriptionsAction.query(auth);
}

export async function refreshNewsFeedAction(auth: ActionAuth) {
  return api.news.refreshNewsFeedAction.mutate(auth);
}

export async function subscribeNewsFeedAction(auth: ActionAuth, sub: { feedUrl: string; name?: string; icon?: string; category?: string }) {
  return api.news.subscribeNewsFeedAction.mutate({ auth, sub });
}

export async function unsubscribeNewsFeedAction(auth: ActionAuth, feedUrl: string) {
  return api.news.unsubscribeNewsFeedAction.mutate({ auth, feedUrl });
}

export async function updateNewsFeedAction(auth: ActionAuth, payload: { oldFeedUrl: string; feedUrl: string; name: string; icon: string; category: string }) {
  return api.news.updateNewsFeedAction.mutate({ auth, payload });
}
