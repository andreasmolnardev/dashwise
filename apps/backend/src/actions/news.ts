
import { ActionAuth, requireUserAuth } from "@dashwise/sdk/data/auth";
import {
  getNewsFeed,
  getNewsSubscriptions,
  refreshNewsFeed,
  subscribeNewsFeed,
  unsubscribeNewsFeed,
  updateNewsFeed,
} from "@dashwise/sdk/data/news";

export async function getNewsFeedAction(auth: ActionAuth, category?: string | null) {
  const { userId } = await requireUserAuth(auth);
  return getNewsFeed(userId, category);
}

export async function getNewsSubscriptionsAction(auth: ActionAuth) {
  const { userId } = await requireUserAuth(auth);
  return getNewsSubscriptions(userId);
}

export async function refreshNewsFeedAction(auth: ActionAuth) {
  const { userId } = await requireUserAuth(auth);
  return refreshNewsFeed(userId);
}

export async function subscribeNewsFeedAction(
  auth: ActionAuth,
  sub: { feedUrl: string; name?: string; icon?: string; category?: string }
) {
  const { userId } = await requireUserAuth(auth);
  return subscribeNewsFeed(userId, sub);
}

export async function unsubscribeNewsFeedAction(auth: ActionAuth, feedUrl: string) {
  const { userId } = await requireUserAuth(auth);
  return unsubscribeNewsFeed(userId, feedUrl);
}

export async function updateNewsFeedAction(
  auth: ActionAuth,
  payload: { oldFeedUrl: string; feedUrl: string; name: string; icon: string; category: string }
) {
  const { userId } = await requireUserAuth(auth);
  return updateNewsFeed(userId, payload);
}
