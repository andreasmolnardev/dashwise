import { getSuperuserPB } from "../lib/pb";
import { getFeedItems } from "./helper";
import PocketBase from "pocketbase";

// --- Type Definitions ---
interface FeedItem {
  title: string;
  link: string;
  pubDate: Date;
  [key: string]: any;
}

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

// --- Job Function ---
export async function newsFeedBuilder(): Promise<{
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
    newsFeeds = await adminPb.collection('newsFeeds').getFullList<NewsFeedRecord>(2000);
  } catch (err: any) {
    console.error("Failed to fetch 'newsFeeds' collection:", err);
    return {
      ...result,
      errors: 1,
      details: [{ action: 'fetch_all_failed', error: err?.message || String(err) }],
    };
  }

  for (const newsFeed of newsFeeds) {
    result.processed++;
    const subscriptions = newsFeed.subscriptions || [];

    if (!subscriptions.length) {
      result.skipped++;
      result.details.push({ feedId: newsFeed.id, action: 'skipped', reason: 'no subscriptions' });
      continue;
    }

    const newFeedData: Record<string, FeedItem[]> = {};
    let feedFetchErrors = 0;

    for (const sub of subscriptions) {
      if (!sub.feedUrl || !sub.category) {
        result.details.push({
          feedId: newsFeed.id,
          subName: sub.name,
          action: 'skip_subscription',
          reason: 'missing feedUrl or category',
        });
        continue;
      }

      try {
        const feedItems = await getFeedItems(sub.feedUrl, maxItemsPerFeed) as FeedItem[];
        if (!newFeedData[sub.category]) {
          newFeedData[sub.category] = [];
        }
        newFeedData[sub.category]!.push(...feedItems);
      } catch (err: any) {
        feedFetchErrors++;
        result.errors++;
        result.details.push({
          feedId: newsFeed.id,
          subName: sub.name,
          feedUrl: sub.feedUrl,
          action: 'feed_fetch_error',
          error: err?.message || String(err),
        });
      }
    }

    // Sort and trim per category
    for (const category in newFeedData) {
      const items = newFeedData[category]!; // safe, we initialized above
      items.sort((a, b) => {
        const timeA = a.pubDate?.getTime() || 0;
        const timeB = b.pubDate?.getTime() || 0;
        return timeB - timeA;
      });
      newFeedData[category] = items.slice(0, maxItemsPerCategory);
    }

    try {
      await adminPb.collection('newsFeeds').update(newsFeed.id, {
        feed: newFeedData,
      });
      result.updated++;
      result.details.push({
        feedId: newsFeed.id,
        action: 'updated',
        categories: Object.keys(newFeedData),
        fetchErrors: feedFetchErrors,
      });
    } catch (err: any) {
      result.errors++;
      result.details.push({
        feedId: newsFeed.id,
        action: 'feed_update_error',
        error: err?.message || String(err),
      });
    }
  }

  console.log("newsFeedBuilder job finished:", result);
  return result;
}
