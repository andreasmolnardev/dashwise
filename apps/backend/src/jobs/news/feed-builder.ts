import {
  getAllNewsFeeds,
  getNewsFeedById,
  getNewsSubscriptionById,
  updateNewsFeedRecord,
  updateNewsSubscription,
} from "../../lib/data/superuser";
import { applyNewsTopics, normalizeMaxFeedItems } from "../../lib/data/news";
import { writeFeedItemsCache } from "../../lib/cache/feed-items";
import { createLogger } from "../../lib/logger";
import { getFeedItems } from "./helper";

interface NewsFeedRecord {
  id: string;
  userId?: string;
  subscriptionRefs?: string[];
  excludedSubscriptionRefs?: string[];
  maxFeedItems?: number;
  [k: string]: any;
}

interface FeedItem {
  title: string;
  link: string;
  pubDate: Date;
  isoDate?: string;
  content?: string;
  thumbnailUrl?: string;
  description?: string;
  summary?: string;
  [key: string]: any;
}

const logger = createLogger("NewsFeedBuilder");

export async function newsFeedBuilder(feedId?: string): Promise<{
  processed: number;
  skipped: number;
  updated: number;
  errors: number;
  details: Array<any>;
}> {
  const result = { processed: 0, skipped: 0, updated: 0, errors: 0, details: [] as any[] };

  logger.info("Running news feed builder");

  let newsFeeds: NewsFeedRecord[] = [];
  try {
    if (feedId) {
      const singleSubscription = await getNewsSubscriptionById(feedId).catch(() => null);
      if (singleSubscription) {
        newsFeeds = [{ id: singleSubscription.id, subscriptionRefs: [singleSubscription.id] }];
      } else {
        const singleFeed = await getNewsFeedById(feedId);
        newsFeeds = singleFeed ? [singleFeed as NewsFeedRecord] : [];
      }
    } else {
      const records = await getAllNewsFeeds(2000);
      newsFeeds = Array.isArray(records) ? (records as NewsFeedRecord[]) : [];
    }
  } catch (err: any) {
    logger.error("Failed to fetch news records", err);
    return {
      ...result,
      errors: 1,
      details: [{ action: feedId ? 'fetch_one_failed' : 'fetch_all_failed', feedId, error: err?.message || String(err) }],
    };
  }

  if (!newsFeeds.length) {
    result.skipped = 1;
    result.details.push({ action: feedId ? 'skipped' : 'skipped_all', feedId, reason: 'no news feeds' });
    logger.info("News feed builder skipped: no news feeds found");
    return result;
  }

  const processFeed = async (newsFeed: NewsFeedRecord) => {
    const feedResult = { processed: 1, skipped: 0, updated: 0, errors: 0, details: [] as any[] };
    const maxFeedItems = normalizeMaxFeedItems(newsFeed.maxFeedItems);
    const subscriptions = newsFeed.subscriptionRefs?.length
      ? newsFeed.subscriptionRefs.map((subscriptionId) => ({ id: String(subscriptionId), url: String(subscriptionId) }))
      : newsFeed.id
        ? [{ id: newsFeed.id, url: newsFeed.id }]
        : [];

    if (!subscriptions.length) {
      feedResult.skipped++;
      feedResult.details.push({ feedId: newsFeed.id, action: 'skipped', reason: 'no subscriptions' });
      return feedResult;
    }

    let feedFetchErrors = 0;
    let cachedCount = 0;

    // Fetch subscriptions in parallel
    const subPromises = subscriptions.map(async (sub) => {
      const subscriptionRecord = sub.id ? await getNewsSubscriptionById(sub.id).catch(() => null) : null;
      const feedUrl = String(subscriptionRecord?.url || sub.url || "");

      if (!feedUrl) {
        return {
          action: 'skip_subscription',
          subName: subscriptionRecord?.title || subscriptionRecord?.url || sub.id,
          reason: 'missing feedUrl',
        };
      }

      try {
        const feedItems = await getFeedItems({
          feedUrl,
          maxItems: maxFeedItems,
          feedName: subscriptionRecord?.title || feedUrl,
          linkReplaceRule: subscriptionRecord?.linkReplaceRule as Record<string, string> | undefined,
          thumbnailOverwriteUrl: subscriptionRecord?.thumbnailOverwriteUrl,
          fallbackThumbnailUrl: subscriptionRecord?.fallbackThumbnailUrl,
        }) as FeedItem[];
        if (subscriptionRecord?.id) {
          await updateNewsSubscription(subscriptionRecord.id, { fetchErrors: "" });
        }
        return {
          action: 'success',
          feedUrl,
          subscription: subscriptionRecord,
          items: feedItems
        };
      } catch (err: any) {
        const error = err?.message || String(err);
        const subName = subscriptionRecord?.title || subscriptionRecord?.name || subscriptionRecord?.url || sub.id;
        if (subscriptionRecord?.id) {
          await updateNewsSubscription(subscriptionRecord.id, { fetchErrors: error });
        }
        logger.error(`Error fetching feed "${subName}": ${error}`);
        return {
          action: 'feed_fetch_error',
          subName,
          feedUrl,
          error,
        };
      }
    });

    const subResults = await Promise.all(subPromises);
    const feedItems: Array<FeedItem & { subscription_id: string; subscription_name: string }> = [];
    const topicSubscriptions: any[] = [];

    for (const res of subResults) {
      if (res.action === 'success') {
        const items = (res.items ?? []).slice(0, maxFeedItems);
        const subscriptionId = String(res.subscription?.id || "");
        const subscriptionName = String(res.subscription?.title || res.subscription?.name || res.feedUrl || "Subscription");
        if (res.subscription) topicSubscriptions.push(res.subscription);
        feedItems.push(...items.map((item) => ({
          ...item,
          subscription_id: subscriptionId,
          subscription_name: subscriptionName,
        })));
      } else if (res.action === 'feed_fetch_error') {
        feedFetchErrors++;
        feedResult.errors++;
        feedResult.details.push({ feedId: newsFeed.id, ...res });
      } else {
        feedResult.details.push({ feedId: newsFeed.id, ...res });
      }
    }

    let cachedItems: Array<FeedItem & { subscription_id: string; subscription_name: string }> = feedItems;
    if (newsFeed.userId) {
      try {
        const sortedItems = feedItems.sort((left, right) => new Date(right.pubDate).getTime() - new Date(left.pubDate).getTime());
        const groupedItems = await applyNewsTopics(String(newsFeed.userId), sortedItems, topicSubscriptions);
        cachedItems = groupedItems.slice(0, maxFeedItems) as typeof feedItems;
        await updateNewsFeedRecord(newsFeed.id, {
          feedCache: cachedItems,
          maxFeedItems,
        });
        feedResult.updated++;
      } catch (err: any) {
        feedResult.errors++;
        feedResult.details.push({
          feedId: newsFeed.id,
          action: 'feed_cache_update_error',
          error: err?.message || String(err),
        });
      }
    }

    try {
      await writeFeedItemsCache(newsFeed.id, cachedItems, [newsFeed.id]);
      cachedCount++;
    } catch (err: any) {
      feedResult.errors++;
      feedResult.details.push({
        feedId: newsFeed.id,
        action: 'redis_cache_write_error',
        error: err?.message || String(err),
      });
    }

    feedResult.updated += cachedCount;
    feedResult.details.push({
      feedId: newsFeed.id,
      action: 'cache_updated',
      cached: cachedCount,
      fetchErrors: feedFetchErrors,
    });

    return feedResult;
  };

  // Process all feeds in parallel
  const feedPromises = newsFeeds.map(feed => processFeed(feed));
  const allFeedResults = await Promise.all(feedPromises);

  // Aggregate results
  for (const fr of allFeedResults) {
    result.processed += fr.processed;
    result.skipped += fr.skipped;
    result.updated += fr.updated;
    result.errors += fr.errors;
    result.details.push(...fr.details);
  }

  logger.debug("News feed builder finished", result);

  if (result.errors === 0) {
    logger.info(`News feed builder finished successfully: processed=${result.processed} updated=${result.updated} skipped=${result.skipped}`);
  } else {
    logger.warn(`News feed builder finished with errors: processed=${result.processed} updated=${result.updated} skipped=${result.skipped} errors=${result.errors}`);
  }

  return result;
}
