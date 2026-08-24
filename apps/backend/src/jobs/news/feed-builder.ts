import {
  applyNewsTopics,
  articleKey,
  canonicalizeArticleUrl,
  isAllNewsFeed,
  normalizeMaxFeedItems,
  normalizeSubscription,
  type NewsSubscription,
} from "../../lib/data/news";
import {
  getAllNewsFeeds,
  getAllNewsSubscriptions,
  getNewsFeedById,
  getNewsSubscriptionById,
  updateNewsSubscription,
} from "../../lib/data/superuser";
import {
  readSubscriptionArticles,
  type CachedArticle,
  writeMaterializedFeed,
  writeSubscriptionArticles,
} from "../../lib/cache/feed-items";
import { createLogger } from "../../lib/logger";
import { getFeedItems } from "./helper";
import type { NewsFeedItem } from "@dashwise/types/sdk";

export type NewsFeedRecord = {
  id: string;
  userId?: string;
  title?: string;
  feedType?: "all" | "custom" | string;
  systemKey?: string;
  subscriptionRefs?: string[];
  excludedSubscriptionRefs?: string[];
  maxFeedItems?: number;
  [key: string]: unknown;
};

type BuilderOptions = { userId?: string; feedIds?: string[] };

const logger = createLogger("NewsFeedBuilder");
const SUBSCRIPTION_RETENTION = 500;

function itemTime(item: Record<string, unknown>) {
  const value = item.pubDate;
  const time = value instanceof Date ? value.getTime() : new Date(String(value || "")).getTime();
  return Number.isFinite(time) ? time : 0;
}

function completeness(article: CachedArticle) {
  const json = article.json;
  return Object.values(json).reduce<number>((total, value) => total + (value == null ? 0 : String(value).length), 0);
}

function normalizeArticle(raw: Record<string, unknown>, subscription: NewsSubscription): CachedArticle | null {
  const pubDate = new Date(String(raw.pubDate || raw.isoDate || ""));
  if (!Number.isFinite(pubDate.getTime())) return null;

  const item: Record<string, unknown> = {
    ...raw,
    title: String(raw.title || "No Title"),
    link: String(raw.link || ""),
    pubDate: pubDate.toISOString(),
    subscription_id: String(subscription.id || ""),
    subscription_name: String(subscription.title || subscription.name || subscription.url || "Subscription"),
  };
  const dedupeKey = articleKey(item as NewsFeedItem, String(subscription.url || ""));
  if (!dedupeKey) return null;

  return {
    dedupeKey,
    canonicalUrl: canonicalizeArticleUrl(String(item.link || "")) || undefined,
    guid: String(item.guid || item.id || "") || undefined,
    title: String(item.title || ""),
    publishedAt: pubDate.getTime(),
    json: { ...item, dedupeKey },
  };
}

export function deduplicateSubscriptionArticles(items: Record<string, unknown>[], subscription: NewsSubscription) {
  const deduped = new Map<string, CachedArticle>();
  for (const item of items) {
    const normalized = normalizeArticle(item, subscription);
    if (!normalized) continue;
    const existing = deduped.get(normalized.dedupeKey);
    if (!existing || completeness(normalized) > completeness(existing)) deduped.set(normalized.dedupeKey, normalized);
  }
  return Array.from(deduped.values()).sort((left, right) => right.publishedAt - left.publishedAt);
}

async function fetchAndCacheSubscription(subscription: NewsSubscription, result: { errors: number; details: any[] }) {
  const id = String(subscription.id || "");
  const feedUrl = String(subscription.url || subscription.feedUrl || "");
  if (!id || !feedUrl) return false;

  try {
    const raw = await getFeedItems({
      feedUrl,
      maxItems: SUBSCRIPTION_RETENTION,
      feedName: subscription.title || feedUrl,
      linkReplaceRule: subscription.linkReplaceRule,
      thumbnailOverwriteUrl: subscription.thumbnailOverwriteUrl,
      fallbackThumbnailUrl: subscription.fallbackThumbnailUrl,
    });
    const articles = deduplicateSubscriptionArticles(raw as unknown as Record<string, unknown>[], subscription);
    await writeSubscriptionArticles(id, articles);
    await updateNewsSubscription(id, { fetchErrors: "" });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.errors++;
    result.details.push({ subscriptionId: id, action: "feed_fetch_error", error: message });
    await updateNewsSubscription(id, { fetchErrors: message }).catch(() => undefined);
    logger.error(`Error fetching feed "${subscription.title || feedUrl}": ${message}`);
    // A failed fetch deliberately leaves the previous sorted-set cache intact.
    return false;
  }
}

function normalizeFeed(record: Record<string, unknown>): NewsFeedRecord | null {
  if (!record.id) return null;
  return {
    ...record,
    id: String(record.id),
    userId: record.userId ? String(record.userId) : undefined,
    title: String(record.title || ""),
    feedType: record.feedType ? String(record.feedType) : undefined,
    systemKey: record.systemKey ? String(record.systemKey) : undefined,
    subscriptionRefs: Array.isArray(record.subscriptionRefs) ? record.subscriptionRefs.map(String) : [],
    excludedSubscriptionRefs: Array.isArray(record.excludedSubscriptionRefs) ? record.excludedSubscriptionRefs.map(String) : [],
  };
}

export function deduplicateUserArticles(
  articles: CachedArticle[],
  selectedSubscriptionIds: Set<string>,
  subscriptionsById: Map<string, NewsSubscription>,
) {
  const deduped = new Map<string, CachedArticle>();
  for (const article of articles) {
    const existing = deduped.get(article.dedupeKey);
    if (!existing || completeness(article) > completeness(existing)) deduped.set(article.dedupeKey, article);
  }

  return Array.from(deduped.values()).map((article) => {
    const sourceIds = Array.from(new Set(article.sourceIds || []));
    const selectedSourceId = sourceIds.find((id) => selectedSubscriptionIds.has(id)) ||
      String(article.json.subscription_id || "");
    const selectedSource = subscriptionsById.get(selectedSourceId);
    const sourceSubscriptions = sourceIds
      .map((id) => subscriptionsById.get(id))
      .filter((subscription): subscription is NewsSubscription => Boolean(subscription && subscription.id))
      .map((subscription) => ({
        id: String(subscription.id),
        title: String(subscription.title || subscription.name || subscription.url || "Subscription"),
      }));

    return {
      ...article.json,
      dedupeKey: article.dedupeKey,
      subscription_id: selectedSourceId,
      subscription_name: String(selectedSource?.title || selectedSource?.name || article.json.subscription_name || "Subscription"),
      sourceSubscriptions,
    } as NewsFeedItem;
  });
}

export function selectNewsFeedSubscriptions(
  userSubscriptions: NewsSubscription[],
  record: NewsFeedRecord | null,
) {
  const exclusions = new Set((record?.excludedSubscriptionRefs || []).map(String));
  if (isAllNewsFeed(record)) {
    return userSubscriptions.filter((subscription) => subscription.id && !exclusions.has(String(subscription.id)));
  }
  const refs = new Set((record?.subscriptionRefs || []).map(String));
  return userSubscriptions.filter((subscription) => subscription.id && refs.has(String(subscription.id)) && !exclusions.has(String(subscription.id)));
}

async function loadMaterializedArticles(
  selectedSubscriptions: NewsSubscription[],
  allSubscriptions: NewsSubscription[],
) {
  const selectedIds = new Set(selectedSubscriptions.map((subscription) => String(subscription.id || "")).filter(Boolean));
  const subscriptionsById = new Map(allSubscriptions.map((subscription) => [String(subscription.id || ""), subscription]));
  const sourceArticles: CachedArticle[] = [];

  for (const subscription of selectedSubscriptions) {
    const articles = await readSubscriptionArticles(String(subscription.id || ""));
    for (const article of articles) {
      const sourceIds = article.sourceIds || [];
      if (!sourceIds.length) {
        article.sourceIds = [String(subscription.id || "")];
      }
      sourceArticles.push(article);
    }
  }

  return deduplicateUserArticles(sourceArticles, selectedIds, subscriptionsById)
    .sort((left, right) => itemTime(right as Record<string, unknown>) - itemTime(left as Record<string, unknown>));
}

async function buildUserFeed(
  userId: string,
  feedId: string,
  record: NewsFeedRecord | null,
  allSubscriptions: NewsSubscription[],
  sourceRevision: string,
  result: { errors: number; updated: number; details: any[] },
) {
  const userSubscriptions = allSubscriptions.filter((subscription) => !subscription.userId || subscription.userId === userId);
  // The all-feed record is optional for users created before feed records were
  // introduced. Keep the materialized `all` view dynamic in that case instead
  // of treating a missing record like an empty custom feed.
  const effectiveRecord = feedId === "all" && !record
    ? {
        id: "all",
        title: "All feed",
        feedType: "all" as const,
        systemKey: "all",
        subscriptionRefs: [],
        excludedSubscriptionRefs: [],
      }
    : record;
  const selectedSubscriptions = selectNewsFeedSubscriptions(userSubscriptions, effectiveRecord);
  const maxFeedItems = normalizeMaxFeedItems(effectiveRecord?.maxFeedItems);

  try {
    const sortedItems = (await loadMaterializedArticles(selectedSubscriptions, allSubscriptions)).slice(0, maxFeedItems);
    const groupedItems = await applyNewsTopics(userId, sortedItems, selectedSubscriptions);
    const materialized = groupedItems.map((item) => ({
      id: String(item.dedupeKey || articleKey(item)),
      score: itemTime(item as Record<string, unknown>),
      json: item as unknown as Record<string, unknown>,
    }));
    await writeMaterializedFeed(userId, feedId, materialized, sourceRevision);
    result.updated++;
    result.details.push({ userId, feedId, action: "view_cache_updated", itemCount: materialized.length });
  } catch (error) {
    result.errors++;
    result.details.push({ userId, feedId, action: "view_cache_update_error", error: error instanceof Error ? error.message : String(error) });
  }
}

export async function newsFeedBuilder(feedId?: string, options: BuilderOptions = {}): Promise<{
  processed: number;
  skipped: number;
  updated: number;
  errors: number;
  details: Array<any>;
}> {
  const result = { processed: 0, skipped: 0, updated: 0, errors: 0, details: [] as any[] };
  const sourceRevision = `${Date.now()}`;
  logger.info("Running news feed builder");

  const rawSubscriptions = await getAllNewsSubscriptions(2000, {
    fields: "id,url,icon,title,linkReplaceRule,fallbackThumbnailUrl,thumbnailOverwriteUrl,userId,similarityGroupingWordsBlacklist,enableTopicGrouping,fetchErrors",
  });
  if (!Array.isArray(rawSubscriptions)) {
    result.errors++;
    result.details.push({ action: "fetch_subscriptions_failed" });
    return result;
  }
  const allSubscriptions = (Array.isArray(rawSubscriptions) ? rawSubscriptions : [])
    .map((record) => normalizeSubscription(record as Record<string, unknown>))
    .filter((subscription): subscription is NewsSubscription => Boolean(subscription?.id));
  const rawFeeds = await getAllNewsFeeds(2000);
  const feeds = (Array.isArray(rawFeeds) ? rawFeeds : [])
    .map((record) => normalizeFeed(record as Record<string, unknown>))
    .filter((feed): feed is NewsFeedRecord => Boolean(feed));

  let targetSubscriptionIds = new Set(allSubscriptions.map((subscription) => String(subscription.id)));
  let targetUserIds = new Set<string>(options.userId ? [options.userId] : []);

  const requestedIds = Array.from(new Set([...(options.feedIds || []), ...(feedId ? [feedId] : [])].map(String).filter(Boolean)));
  if (requestedIds.length) {
    targetSubscriptionIds = new Set<string>();
    for (const requestedId of requestedIds) {
      if (requestedId === "all" && options.userId) {
        for (const subscription of allSubscriptions.filter((entry) => !entry.userId || entry.userId === options.userId)) {
          if (subscription.id) targetSubscriptionIds.add(String(subscription.id));
        }
        continue;
      }
      const subscription = allSubscriptions.find((entry) => String(entry.id) === requestedId) ||
        normalizeSubscription(await getNewsSubscriptionById(requestedId).catch(() => null) as Record<string, unknown> | null);
      if (subscription?.id) {
        targetSubscriptionIds.add(String(subscription.id));
        if (subscription.userId) targetUserIds.add(subscription.userId);
        continue;
      }

      const targetFeed = feeds.find((feed) => String(feed.id) === requestedId) ||
        normalizeFeed(await getNewsFeedById(requestedId).catch(() => null) as Record<string, unknown> || {});
      if (targetFeed?.userId) targetUserIds.add(targetFeed.userId);
      if (targetFeed && !isAllNewsFeed(targetFeed)) {
        for (const id of targetFeed.subscriptionRefs || []) targetSubscriptionIds.add(String(id));
      }
      if (targetFeed && isAllNewsFeed(targetFeed) && targetFeed.userId) {
        for (const subscription of allSubscriptions.filter((entry) => !entry.userId || entry.userId === targetFeed.userId)) {
          if (subscription.id) targetSubscriptionIds.add(String(subscription.id));
        }
      }
    }
  }

  const fetchResults = await Promise.all(allSubscriptions
    .filter((subscription) => targetSubscriptionIds.has(String(subscription.id)))
    .map((subscription) => fetchAndCacheSubscription(subscription, result)));
  result.processed = fetchResults.length;

  const affectedUsers = new Set<string>(targetUserIds);
  for (const subscription of allSubscriptions) {
    if (targetSubscriptionIds.has(String(subscription.id)) && subscription.userId) affectedUsers.add(subscription.userId);
  }
  for (const feed of feeds) {
    if (!feed.userId) continue;
    const refs = new Set(feed.subscriptionRefs || []);
    if (isAllNewsFeed(feed) || Array.from(targetSubscriptionIds).some((id) => refs.has(id))) affectedUsers.add(feed.userId);
  }
  if (!requestedIds.length && !options.userId) {
    for (const feed of feeds) if (feed.userId) affectedUsers.add(feed.userId);
  }

  for (const userId of affectedUsers) {
    const userFeeds = feeds.filter((feed) => feed.userId === userId);
    const allFeed = userFeeds.find((feed) => isAllNewsFeed(feed)) || null;
    await buildUserFeed(userId, "all", allFeed, allSubscriptions, sourceRevision, result);
    for (const feed of userFeeds.filter((entry) => !isAllNewsFeed(entry))) {
      await buildUserFeed(userId, String(feed.id), feed, allSubscriptions, sourceRevision, result);
    }
    for (const subscription of allSubscriptions.filter((entry) => !entry.userId || entry.userId === userId)) {
      if (!subscription.id) continue;
      await buildUserFeed(userId, String(subscription.id), {
        id: String(subscription.id),
        title: String(subscription.title || subscription.name || subscription.url || "Subscription"),
        feedType: "custom",
        subscriptionRefs: [String(subscription.id)],
        excludedSubscriptionRefs: [],
      }, allSubscriptions, sourceRevision, result);
    }
  }

  if (!affectedUsers.size) result.skipped = 1;
  logger.info(`News feed builder finished: processed=${result.processed} updated=${result.updated} skipped=${result.skipped} errors=${result.errors}`);
  return result;
}
