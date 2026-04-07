import axios from "axios";
import { channelId } from "@gonetone/get-youtube-id-by-url";
import config from "../lib/config";
import { getFaviconFromDOM } from "../lib/api/tools/faviconFromDom";
import {
  deleteNewsSubscription,
  getAllNewsFeeds,
  getAllNewsSubscriptions,
  getNewsFeedByTitle,
  getNewsFeedsByUserId,
  getNewsSubscriptionById,
  getNewsSubscriptionByUrl,
  createNewsFeedRecord,
  updateNewsFeedRecord,
  updateNewsSubscription,
  createNewsSubscription,
} from "@dashwise/sdk/data/superuser";

type FeedItem = {
  title: string;
  link: string;
  pubDate: string | Date;
  [key: string]: any;
};

type Subscription = {
  id?: string;
  url: string;
  feedUrl?: string;
  icon?: string;
  json?: unknown;
  title?: string;
  name?: string;
  feedIds?: string[];
};

type FeedRecord = {
  id: string;
  title?: string;
  subscriptionRefs?: string[];
  excludedSubscriptionRefs?: string[];
  [key: string]: any;
};

function escapeFilter(value: string) {
  return value.replace(/"/g, '\\"');
}

function itemTime(item: FeedItem): number {
  const value = item?.pubDate;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? 0 : time;
  }
  return 0;
}

function normalizeSubscription(entry: any): Subscription | null {
  if (!entry) return null;

  const url = String(entry.url || entry.feedUrl || "").trim();
  if (!url) return null;

  return {
    id: entry.id ? String(entry.id) : undefined,
    url,
    feedUrl: url,
    icon: entry.icon ? String(entry.icon) : "",
    json: entry.json,
    title: String(entry.title || entry.name || url),
    name: String(entry.title || entry.name || url),
  };
}

async function getUserFeeds(userId: string): Promise<FeedRecord[]> {
  const feeds = await getAllNewsFeeds(2000);
  return (Array.isArray(feeds) ? feeds : []).filter((feed: any) => String(feed.userId || "") === userId);
}

function buildFeedList(feeds: FeedRecord[]) {
  return [
    { id: "all", title: "All feed" },
    ...feeds.map((feed) => ({
      id: String(feed.id),
      title: String(feed.title || "Untitled feed"),
    })),
  ];
}

function parseCachedItems(raw: unknown): FeedItem[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;

  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return [];
}

function getSubscriptionItems(subscription: Subscription): FeedItem[] {
  return parseCachedItems(subscription.json);
}

async function getUserSubscriptionIdsFromFeeds(feeds: FeedRecord[]) {
  const ids = new Set<string>();

  for (const feed of feeds) {
    for (const id of feed.subscriptionRefs ?? []) {
      ids.add(String(id));
    }
  }

  return ids;
}

async function getUserExcludedSubscriptionIdsFromFeeds(feeds: FeedRecord[]) {
  const ids = new Set<string>();

  for (const feed of feeds) {
    for (const id of feed.excludedSubscriptionRefs ?? []) {
      ids.add(String(id));
    }
  }

  return ids;
}

async function syncSubscriptionFeedRefs(
  userId: string,
  subscriptionId: string,
  feedIds: string[] = [],
  newFeedTitles: string[] = [],
) {
  const feeds = await getNewsFeedsByUserId(userId);
  const selectedIds = new Set(feedIds.map(String).filter(Boolean));

  for (const rawTitle of newFeedTitles) {
    const title = String(rawTitle || "").trim();
    if (!title) continue;

    const existingFeed = await getNewsFeedByTitle(userId, title).catch(() => null);

    if (existingFeed?.id) {
      selectedIds.add(String(existingFeed.id));
      continue;
    }

    const createdFeed = await createNewsFeedRecord({
      userId,
      title,
      subscriptionRefs: [subscriptionId],
      excludedSubscriptionRefs: [],
    });
    selectedIds.add(String(createdFeed.id));
  }

  for (const feed of feeds) {
    const feedId = String(feed.id || "");
    if (!feedId) continue;

    const currentRefs = new Set((feed.subscriptionRefs ?? []).map(String));
    const hasSubscription = currentRefs.has(subscriptionId);

    if (selectedIds.has(feedId)) {
      if (!hasSubscription) {
        currentRefs.add(subscriptionId);
        await updateNewsFeedRecord(feed.id, {
          subscriptionRefs: Array.from(currentRefs),
        });
      }
      continue;
    }

    if (hasSubscription) {
      currentRefs.delete(subscriptionId);
      await updateNewsFeedRecord(feed.id, {
        subscriptionRefs: Array.from(currentRefs),
      });
    }
  }
}

async function buildFeedFromSubscriptions(
  subscriptions: Subscription[],
  feedId?: string | null,
  feeds: FeedRecord[] = [],
) {
  const byId = new Map(subscriptions.filter((subscription) => subscription.id).map((subscription) => [String(subscription.id), subscription] as const));

  const selectByFeed = (feed: FeedRecord) => {
    const refs = new Set((feed.subscriptionRefs ?? []).map(String));
    const exclusions = new Set((feed.excludedSubscriptionRefs ?? []).map(String));
    return subscriptions.filter((subscription) => subscription.id && refs.has(String(subscription.id)) && !exclusions.has(String(subscription.id)));
  };

  let selectedSubscriptions: Subscription[] = subscriptions;

  if (feedId && feedId !== "all") {
    const feedRecord = feeds.find((feed) => String(feed.id) === feedId);
    if (feedRecord) {
      selectedSubscriptions = selectByFeed(feedRecord);
    } else if (byId.has(feedId)) {
      selectedSubscriptions = [byId.get(feedId)!];
    } else {
      selectedSubscriptions = [];
    }
  } else {
    const allFeedRecord = feeds.find((feed) => String(feed.id) === "all" || String(feed.title || "").toLowerCase() === "all feed");
    if (allFeedRecord) {
      selectedSubscriptions = selectByFeed(allFeedRecord);
      if (!selectedSubscriptions.length) {
        selectedSubscriptions = subscriptions;
      }
    }
  }

  const feed: Array<FeedItem & { subscription_id: string; subscription_name: string }> = [];

  for (const subscription of selectedSubscriptions) {
    const subscriptionId = String(subscription.id || "");
    const subscriptionName = String(subscription.title || subscription.name || subscription.url || "Subscription");
    const items = getSubscriptionItems(subscription).sort((a, b) => itemTime(b) - itemTime(a));

    for (const item of items) {
      feed.push({
        ...item,
        subscription_id: subscriptionId,
        subscription_name: subscriptionName,
      });
    }
  }

  return feed.sort((left, right) => itemTime(right) - itemTime(left));
}

export async function getNewsFeed(userId: string, feedId?: string | null) {
  const feeds = await getUserFeeds(userId);
  const subscriptionIds = await getUserSubscriptionIdsFromFeeds(feeds);
  const excludedIds = await getUserExcludedSubscriptionIdsFromFeeds(feeds);

  const allSubscriptions = (await getAllNewsSubscriptions(2000)) as any[];
  const subscriptions = allSubscriptions
    .map(normalizeSubscription)
    .filter((entry: Subscription | null): entry is Subscription => Boolean(entry));

  const scopedSubscriptions = subscriptionIds.size
    ? subscriptions.filter((subscription) => subscription.id && subscriptionIds.has(String(subscription.id)) && !excludedIds.has(String(subscription.id)))
    : subscriptions.filter((subscription) => !excludedIds.has(String(subscription.id || "")));

  const feed = await buildFeedFromSubscriptions(scopedSubscriptions, feedId, feeds);
  return feed;
}

export async function getNewsSubscriptions(userId: string) {
  const feeds = await getUserFeeds(userId);
  const subscriptionIds = await getUserSubscriptionIdsFromFeeds(feeds);

  const allSubscriptions = (await getAllNewsSubscriptions(2000)) as any[];
  const subscriptions = allSubscriptions
    .map(normalizeSubscription)
    .filter((entry: Subscription | null): entry is Subscription => Boolean(entry));

  const scopedSubscriptions = subscriptionIds.size
    ? subscriptions.filter((subscription) => subscription.id && subscriptionIds.has(String(subscription.id)))
    : subscriptions;

  const subscriptionsWithFeedIds = scopedSubscriptions.map((subscription) => ({
    ...subscription,
    feedIds: feeds
      .filter((feed) => (feed.subscriptionRefs ?? []).map(String).includes(String(subscription.id || "")))
      .map((feed) => String(feed.id)),
  }));

  return {
    id: null,
    subscriptions: subscriptionsWithFeedIds,
  };
}

export async function getNewsFeeds(userId: string) {
  const feeds = await getUserFeeds(userId);

  return {
    id: null,
    feeds: buildFeedList(feeds),
  };
}

export async function refreshNewsFeed(userId: string) {
  if (!config.jobs_webhook_enabled) {
    return { message: "Jobs webhook is disabled" };
  }

  const url = `${config.jobs_url}/webhook/newsFeedBuilder`;
  const response = await axios.get(url);
  return response.data;
}

export async function subscribeNewsFeed(
  userId: string,
  sub: { feedUrl: string; name?: string; icon?: string; feedIds?: string[]; newFeedTitles?: string[] }
) {
  const originalFeedUrl = sub.feedUrl;
  if (originalFeedUrl.includes("https://www.youtube.com/@")) {
    const id = await channelId(originalFeedUrl);
    if (id) {
      sub.feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;
    }
  }

  if (!sub.name && originalFeedUrl.includes("https://www.youtube.com/@")) {
    const match = originalFeedUrl.match(/@([^/?#]+)/);
    sub.name = match?.[1] ? `@${match[1]}` : originalFeedUrl;
  }

  sub.icon = sub.icon?.trim() || (await getFaviconFromDOM(sub.feedUrl, true)) || "";

  const existing = await getNewsSubscriptionByUrl(sub.feedUrl).catch(() => null);

  if (existing) {
    await updateNewsSubscription(existing.id, {
      url: sub.feedUrl,
      icon: sub.icon,
      json: existing.json ?? [],
    });

    if (existing.id) {
      await syncSubscriptionFeedRefs(userId, existing.id, sub.feedIds ?? [], sub.newFeedTitles ?? []);
    }
  } else {
    const created = await createNewsSubscription({
      url: sub.feedUrl,
      icon: sub.icon,
      json: [],
    });

    if (created?.id) {
      await syncSubscriptionFeedRefs(userId, created.id, sub.feedIds ?? [], sub.newFeedTitles ?? []);
    }
  }

  if (config.jobs_webhook_enabled) {
    await fetch(config.jobs_url + "/webhook/newsFeedBuilder");
  }

  return { message: "Feed successfully subscribed." };
}

export async function unsubscribeNewsFeed(userId: string, subscriptionId: string) {
  await deleteNewsSubscription(subscriptionId);
  return { message: "Subscription removed." };
}

export async function updateNewsFeed(
  userId: string,
  payload: { subscriptionId?: string; oldFeedUrl?: string; feedUrl: string; title?: string; icon?: string; feedIds?: string[]; }
) {
  const target = payload.subscriptionId
    ? await getNewsSubscriptionById(payload.subscriptionId)
    : payload.oldFeedUrl
      ? await getNewsSubscriptionByUrl(payload.oldFeedUrl)
      : null;

  if (!target) {
    return { _status: 404, error: "Subscription not found" };
  }

  await updateNewsSubscription(target.id, {
    url: payload.feedUrl,
    title: payload.title,
    icon: payload.icon || target.icon || "",
    json: target.json ?? [],
  });

  await syncSubscriptionFeedRefs(userId, target.id, payload.feedIds ?? []);

  return { message: "Subscription updated" };
}
