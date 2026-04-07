import type { ActionAuth } from "@dashwise/sdk/data/auth";
import { api } from "@/lib/apiClient";

export async function getNewsFeedAction(auth: ActionAuth, feedId?: string | null) {
  return api.news.getNewsFeedAction({ auth, feedId });
}

export async function getNewsSubscriptionsAction(auth: ActionAuth) {
  return api.news.getNewsSubscriptionsAction(auth);
}

export async function getNewsFeedsAction(auth: ActionAuth) {
  return api.news.getNewsFeedsAction(auth);
}

export async function getNewsFeedMetadataAction(auth: ActionAuth, url: string) {
  return api.news.getNewsFeedMetadataAction({ auth, url });
}

export async function refreshNewsFeedAction(auth: ActionAuth) {
  return api.news.refreshNewsFeedAction(auth);
}

export async function subscribeNewsFeedAction(auth: ActionAuth, sub: { feedUrl: string; name?: string; icon?: string; feedIds?: string[]; newFeedTitles?: string[]; }) {
  return api.news.subscribeNewsFeedAction({ auth, sub });
}

export async function unsubscribeNewsFeedAction(auth: ActionAuth, feedUrl: string) {
  return api.news.unsubscribeNewsFeedAction({ auth, feedUrl });
}

export async function updateNewsFeedAction(auth: ActionAuth, payload: { subscriptionId?: string; feedUrl: string; title?: string; icon?: string; feedIds?: string[]; }) {
  return api.news.updateNewsFeedAction({ auth, payload });
}
