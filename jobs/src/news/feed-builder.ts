import { getSuperuserPB } from "../lib/pb";
import { FeedItem, getFeedItems } from "./helper";
import PocketBase from "pocketbase";

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

export async function newsFeedBuilder(feedId?: string): Promise<{
  processed: number;
  skipped: number;
  updated: number;
  errors: number;
  details: Array<any>;
}> {
  const adminPb = await getSuperuserPB() as PocketBase;
  const result = { processed: 0, skipped: 0, updated: 0, errors: 0, details: [] as any[] };

  const maxItemsPerFeed = 100;
  const maxItemsPerCategory = 100;

  console.log("Running newsFeedBuilder job...");

  let newsFeeds: NewsFeedRecord[] = [];
  try {
    if (feedId) {
      const singleFeed = await adminPb.collection('newsFeeds').getOne<NewsFeedRecord>(feedId);
      newsFeeds = [singleFeed];
    } else {
      newsFeeds = await adminPb.collection('newsFeeds').getFullList<NewsFeedRecord>(2000);
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

    const newFeedData: Record<string, FeedItem[]> = {};
    let feedFetchErrors = 0;

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
          category: sub.category,
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
        if (!newFeedData[res.category!]) {
          newFeedData[res.category!] = [];
        }
        newFeedData[res.category!]!.push(...res.items!);
      } else if (res.action === 'feed_fetch_error') {
        feedFetchErrors++;
        feedResult.errors++;
        feedResult.details.push({ feedId: newsFeed.id, ...res });
      } else {
        feedResult.details.push({ feedId: newsFeed.id, ...res });
      }
    }

    // Sort and trim per category
    for (const category in newFeedData) {
      const items = newFeedData[category]!;
      items.sort((a, b) => {
        const timeA = a.pubDate?.getTime() || 0;
        const timeB = b.pubDate?.getTime() || 0;
        return timeB - timeA;
      });
      newFeedData[category] = items.slice(0, maxItemsPerCategory);
    }

    const hasAnyItems = Object.values(newFeedData).some(arr => arr.length > 0);

    if (!hasAnyItems) {
      feedResult.skipped++;
      feedResult.details.push({
        feedId: newsFeed.id,
        action: 'skipped_update',
        reason: 'no valid feed data (all fetches failed)',
      });
      return feedResult;
    }

    try {
      await adminPb.collection('newsFeeds').update(newsFeed.id, {
        feed: newFeedData,
      });
      feedResult.updated++;
      feedResult.details.push({
        feedId: newsFeed.id,
        action: 'updated',
        categories: Object.keys(newFeedData),
        fetchErrors: feedFetchErrors,
      });
    } catch (err: any) {
      feedResult.errors++;
      feedResult.details.push({
        feedId: newsFeed.id,
        action: 'feed_update_error',
        error: String(err),
      });
    }

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