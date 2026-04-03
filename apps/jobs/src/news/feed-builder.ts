import { FeedItem, getFeedItems } from "./helper";
import {
  createNewsFeedItemsCache,
  getAllNewsFeeds,
  getNewsFeedById,
  getNewsFeedItemsCacheByUrl,
  updateNewsFeedItemsCache,
} from "@dashwise/sdk/data/superuser";

interface Subscription {
  category: string;
  feedUrl: string;
  icon?: string;
  name?: string;
}

interface NewsFeedRecord {
  id: string;
  subscriptions?: Subscription[];
  [k: string]: any;
}

interface NewsFeedItemsCacheRecord {
  id: string;
  url: string;
  json: string;
  [k: string]: any;
}

function escapeFilter(str: string) {
  return str.replace(/"/g, '\\"');
}

export async function newsFeedBuilder(feedId?: string): Promise<{
  processed: number;
  skipped: number;
  updated: number;
  errors: number;
  details: Array<any>;
}> {
  const result = { processed: 0, skipped: 0, updated: 0, errors: 0, details: [] as any[] };

  const maxItemsPerFeed = 10;

  console.log("Running newsFeedBuilder job...");

  let newsFeeds: NewsFeedRecord[] = [];
  try {
    if (feedId) {
      const singleFeed = await getNewsFeedById(feedId);
      newsFeeds = [singleFeed as NewsFeedRecord];
    } else {
      newsFeeds = (await getAllNewsFeeds(2000)) as NewsFeedRecord[];
    }
  } catch (err: any) {
    console.error("Failed to fetch 'newsFeeds':", err);
    return {
      ...result,
      errors: 1,
      details: [{ action: feedId ? 'fetch_one_failed' : 'fetch_all_failed', feedId, error: err?.message || String(err) }],
    };
  }

  const processFeed = async (newsFeed: NewsFeedRecord) => {
    const feedResult = { processed: 1, skipped: 0, updated: 0, errors: 0, details: [] as any[] };
    const subscriptions = newsFeed.subscriptions || [];

    if (!subscriptions.length) {
      feedResult.skipped++;
      feedResult.details.push({ feedId: newsFeed.id, action: 'skipped', reason: 'no subscriptions' });
      return feedResult;
    }

    let feedFetchErrors = 0;
    let cachedCount = 0;

    // Fetch subscriptions in parallel
    const subPromises = subscriptions.map(async (sub) => {
      if (!sub.feedUrl || !sub.category) {
        return {
          action: 'skip_subscription',
          subName: sub.name,
          reason: 'missing feedUrl or category',
        };
      }

      try {
        const feedItems = await getFeedItems({ feedUrl: sub.feedUrl, maxItems: maxItemsPerFeed, feedName: sub.name }) as FeedItem[];
        return {
          action: 'success',
          feedUrl: sub.feedUrl,
          items: feedItems
        };
      } catch (err: any) {
        return {
          action: 'feed_fetch_error',
          subName: sub.name,
          feedUrl: sub.feedUrl,
          error: err?.message || String(err),
        };
      }
    });

    const subResults = await Promise.all(subPromises);

    for (const res of subResults) {
      if (res.action === 'success') {
        const items = (res.items ?? []).slice(0, maxItemsPerFeed);
        try {
          const existing = await getNewsFeedItemsCacheByUrl(res.feedUrl!);

          const existingItem = existing.items.length > 0 ? existing.items[0] : undefined;

          if (existingItem) {
            await updateNewsFeedItemsCache(existingItem.id, {
              url: res.feedUrl,
              json: JSON.stringify(items),
            });
          } else {
            await createNewsFeedItemsCache({
              url: res.feedUrl,
              json: JSON.stringify(items),
            });
          }

          cachedCount++;
        } catch (err: any) {
          feedResult.errors++;
          feedResult.details.push({
            feedId: newsFeed.id,
            action: 'cache_upsert_error',
            feedUrl: res.feedUrl,
            error: err?.message || String(err),
          });
        }
      } else if (res.action === 'feed_fetch_error') {
        feedFetchErrors++;
        feedResult.errors++;
        feedResult.details.push({ feedId: newsFeed.id, ...res });
      } else {
        feedResult.details.push({ feedId: newsFeed.id, ...res });
      }
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

  console.log("newsFeedBuilder job finished:", result);
  return result;
}