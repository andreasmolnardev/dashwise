import Parser from "rss-parser";

import {
  createNewsFeedItemsCache,
  getAllNewsSubscriptions,
  getNewsFeedById,
  getNewsSubscriptionById,
  getNewsFeedItemsCacheByUrl,
  updateNewsFeedItemsCache,
} from "@dashwise/sdk/data/superuser";
import { createLogger } from "../../lib/logger";

interface Subscription {
  id?: string;
  url?: string;
  icon?: string;
  title?: string;
}

interface NewsFeedRecord {
  id: string;
  subscriptionRefs?: string[];
  excludedSubscriptionRefs?: string[];
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

type ParserItem = Parser.Item & FeedItem & {
  'media:thumbnail'?: { $: { url: string } } | string;
  enclosure?: { url: string; type: string };
};

async function getFeedItems({
  feedUrl,
  maxItems = 100,
  feedName,
}: {
  feedUrl: string;
  maxItems?: number;
  feedName?: string | undefined;
}): Promise<FeedItem[]> {
  const parser = new Parser<any, FeedItem>({
    customFields: {
      item: [
        ["pubDate", "pubDate"],
        ["dc:date", "pubDate"],
        ["media:thumbnail", "media:thumbnail"],
        ["media:group", "media:group"],
        ["enclosure", "enclosure"],
        ["content:encoded", "content:encoded"],
      ],
    },
  });

  try {
    const feed = await parser.parseURL(feedUrl);

    if (!feed.items || feed.items.length === 0) {
      return [];
    }

    const formattedItems = feed.items
      .map((item: ParserItem) => {
        const dateString = item.isoDate || item.pubDate;
        const thumbnailUrl = getThumbnail(item, feed?.image?.url);
        const descriptionText = getDescription(item);

        return {
          title: getTextContent(item.title) || "No Title",
          link: item.link || "",
          description: descriptionText || "",
          content: (getHtmlContent(item) ?? item.content) as string | undefined,
          pubDate: dateString ? new Date(dateString) : new Date(),
          thumbnailUrl: thumbnailUrl || undefined,
          author: item.author || item.creator || undefined,
          source: feedName,
        } as FeedItem;
      })
      .filter((item: FeedItem) => item.pubDate instanceof Date && !Number.isNaN(item.pubDate.getTime()));

    return formattedItems.slice(0, maxItems);
  } catch (error: any) {
    logger.error(`Error fetching or parsing feed: ${feedUrl}`, error);
    return [];
  }
}

function getHtmlContent(item: ParserItem, prioritizeEncode?: boolean) {
  let contentDescription;

  if (prioritizeEncode === true) {
    contentDescription = item["content:encoded"] ?? item.content ?? item.description ?? item.summary;
  } else {
    contentDescription = item.content ?? item["content:encoded"] ?? item.description ?? item.summary;
  }

  if (!contentDescription) return undefined;

  if (typeof contentDescription === "string") return contentDescription;
  if ((contentDescription as any)._ && typeof (contentDescription as any)._ === "string") {
    return (contentDescription as any)._;
  }
  return String(contentDescription);
}

function getTextContent(text: string) {
  if (!text) {
    return "";
  }

  return decodeHtmlEntities(
    text
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function decodeHtmlEntities(text: string) {
  const namedEntities: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };

  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const codePoint = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    if (entity.startsWith("#")) {
      const codePoint = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    return namedEntities[entity] ?? match;
  });
}

function getFirstImageSource(html: string) {
  const match = html.match(/<img\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? undefined;
}

function getThumbnail(item: any, fallbackUrl?: any): string | undefined {
  const extractUrl = (obj: any): string | undefined => {
    if (!obj) return undefined;

    if (Array.isArray(obj)) {
      for (const entry of obj) {
        const url = extractUrl(entry);
        if (url) return url;
      }
      return undefined;
    }

    if (obj.$?.url) return obj.$.url;
    if (typeof obj === "string") return obj;
    if (obj.url) return obj.url;
    if (obj.href) return obj.href;
    if (obj._) return obj._;

    return undefined;
  };

  const candidates = [
    extractUrl(item?.["media:thumbnail"]),
    extractUrl(item?.["media:group"]),
    extractUrl(item?.enclosure),
    extractUrl(item?.thumbnail),
    extractUrl(item?.image),
    extractUrl(item?.logo),
    getFirstImageSource(item?.content || item?.description || item?.summary || ""),
    typeof fallbackUrl === "string" ? fallbackUrl : extractUrl(fallbackUrl),
  ];

  for (const candidate of candidates) {
    if (candidate && /^https?:\/\//i.test(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function getDescription(item: ParserItem) {
  return item.description || item.summary || (typeof item.content === "string" ? item.content : undefined) || (item as any)["content:encoded"];
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

  const maxItemsPerFeed = 10;

  logger.info("Running news feed builder");

  let newsFeeds: NewsFeedRecord[] = [];
  try {
    if (feedId) {
      const singleSubscription = await getNewsSubscriptionById(feedId).catch(() => null);
      if (singleSubscription) {
        newsFeeds = [{ id: singleSubscription.id, subscriptionRefs: [singleSubscription.id] }];
      } else {
        const singleFeed = await getNewsFeedById(feedId);
        newsFeeds = [singleFeed as NewsFeedRecord];
      }
    } else {
      newsFeeds = (await getAllNewsSubscriptions(2000)) as NewsFeedRecord[];
    }
  } catch (err: any) {
    logger.error("Failed to fetch news records", err);
    return {
      ...result,
      errors: 1,
      details: [{ action: feedId ? 'fetch_one_failed' : 'fetch_all_failed', feedId, error: err?.message || String(err) }],
    };
  }

  const processFeed = async (newsFeed: NewsFeedRecord) => {
    const feedResult = { processed: 1, skipped: 0, updated: 0, errors: 0, details: [] as any[] };
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
        const feedItems = await getFeedItems({ feedUrl, maxItems: maxItemsPerFeed, feedName: subscriptionRecord?.title || feedUrl }) as FeedItem[];
        return {
          action: 'success',
          feedUrl,
          items: feedItems
        };
      } catch (err: any) {
        return {
          action: 'feed_fetch_error',
          subName: subscriptionRecord?.title || subscriptionRecord?.url || sub.id,
          feedUrl,
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

  logger.debug("News feed builder finished", result);
  return result;
}