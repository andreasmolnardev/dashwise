import type { ActionAuth } from "@dashwise/sdk/data/auth";
import type {
  NewsFeedDraft,
  NewsFeedItem,
  NewsFeedMetadata,
  NewsFeedsResponse,
  NewsSubscribeInput,
  NewsSubscriptionsResponse,
  NewsUpdateInput,
} from "@dashwise/sdk/data/news";
import { callApiAction } from "@/lib/apiClient";

export async function getNewsFeedAction(auth: ActionAuth, feedId?: string | null): Promise<NewsFeedItem[]> {
  return callApiAction("news", "getNewsFeedAction", { auth, feedId }) as Promise<NewsFeedItem[]>;
}

export async function getNewsSubscriptionsAction(auth: ActionAuth): Promise<NewsSubscriptionsResponse> {
  return callApiAction("news", "getNewsSubscriptionsAction", auth) as Promise<NewsSubscriptionsResponse>;
}

export async function getNewsFeedsAction(auth: ActionAuth): Promise<NewsFeedsResponse> {
  return callApiAction("news", "getNewsFeedsAction", auth) as Promise<NewsFeedsResponse>;
}

export async function getNewsFeedMetadataAction(auth: ActionAuth, url: string): Promise<NewsFeedMetadata> {
  return callApiAction("news", "getNewsFeedMetadataAction", { auth, url }) as Promise<NewsFeedMetadata>;
}

export async function refreshNewsFeedAction(auth: ActionAuth, feedIds?: string[]) {
  return callApiAction("news", "refreshNewsFeedAction", { auth, feedIds });
}

export async function subscribeNewsFeedAction(auth: ActionAuth, sub: NewsSubscribeInput | NewsFeedDraft) {
  return callApiAction("news", "subscribeNewsFeedAction", { auth, sub });
}

export async function unsubscribeNewsFeedAction(auth: ActionAuth, feedUrl: string) {
  return callApiAction("news", "unsubscribeNewsFeedAction", { auth, feedUrl });
}

export async function updateNewsFeedAction(auth: ActionAuth, payload: NewsUpdateInput | NewsFeedDraft) {
  return callApiAction("news", "updateNewsFeedAction", { auth, payload });
}
