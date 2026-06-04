import type { ActionAuth } from "@dashwise/types/sdk/data/auth";
import type {
  NewsFeedDraft,
  NewsFeedItem,
  NewsFeedMetadata,
  NewsFeedRecord,
  NewsFeedRecordCreateInput,
  NewsFeedRecordUpdateInput,
  NewsFeedsResponse,
  NewsSubscribeInput,
  NewsSubscriptionsResponse,
  NewsUpdateInput,
} from "@dashwise/types/sdk/data/news";
import { callApiAction } from "@/lib/apiClient";

export async function getNewsFeedAction(auth: ActionAuth, feedId?: string | null): Promise<NewsFeedItem[]> {
  return callApiAction("news", "getNewsFeedAction", { auth, feedId }) as Promise<NewsFeedItem[]>;
}

export async function getNewsFeedRecordAction(auth: ActionAuth, feedId?: string | null): Promise<NewsFeedRecord | null> {
  return callApiAction("news", "getNewsFeedRecordAction", { auth, feedId }) as Promise<NewsFeedRecord | null>;
}

export async function createNewsFeedRecordAction(auth: ActionAuth, payload: NewsFeedRecordCreateInput): Promise<NewsFeedRecord | null> {
  return callApiAction("news", "createNewsFeedRecordAction", { auth, payload }) as Promise<NewsFeedRecord | null>;
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

export async function updateNewsFeedRecordAction(auth: ActionAuth, payload: NewsFeedRecordUpdateInput) {
  return callApiAction("news", "updateNewsFeedRecordAction", { auth, payload, feedId: payload.feedId });
}

export async function fixMissingTitlesAction(auth: ActionAuth): Promise<unknown> {
  return callApiAction("news", "fixMissingTitlesAction", { auth }) as Promise<unknown>;
}
