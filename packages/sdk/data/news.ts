import Parser from 'rss-parser';
import { channelId } from "@gonetone/get-youtube-id-by-url";
import config from "../lib/config";
import { getFaviconFromDOM } from "../lib/api/tools/faviconFromDom";
import {
  deleteNewsSubscription,
  getAllNewsFeeds,
  getAllNewsSubscriptions,
  getNewsFeedById,
  getNewsFeedByTitle,
  getNewsFeedsByUserId,
  getNewsSubscriptionById,
  getNewsSubscriptionByUrl,
  createNewsFeedRecord,
  updateNewsFeedRecord,
  updateNewsSubscription,
  createNewsSubscription,
} from "@dashwise/sdk/data/superuser";

export type NewsFeedItem = {
  title: string;
  link: string;
  pubDate: string | Date;
  subscription_id: string;
  subscription_name: string;
  [key: string]: unknown;
};

export type NewsSubscription = {
  id?: string;
  url: string;
  feedUrl?: string;
  icon?: string;
  json?: unknown;
  title?: string;
  name?: string;
  feedIds?: string[];
  newFeedTitles?: string[];
};

export type NewsFeedMetadata = {
  feedUrl: string;
  title: string;
  icon: string;
};

export type NewsFeedSummary = {
  id: string;
  title: string;
};

export type NewsFeedsResponse = {
  id: null;
  feeds: NewsFeedSummary[];
};

export type NewsSubscriptionsResponse = {
  id: null;
  subscriptions: NewsFeedDraft[];
};

export type NewsSubscribeInput = {
  feedUrl: string;
  name?: string;
  icon?: string;
  feedIds?: string[];
  newFeedTitles?: string[];
};

export type NewsUpdateInput = {
  subscriptionId?: string;
  oldFeedUrl?: string;
  feedUrl: string;
  title?: string;
  icon?: string;
  feedIds?: string[];
};

export type NewsFeedDraft = Omit<NewsSubscription, "feedUrl" | "url"> & {
  feedUrl: string;
  url?: string;
};

export type NewsFeedRecord = {
  id: string;
  title?: string;
  subscriptionRefs?: string[];
  excludedSubscriptionRefs?: string[];
};

export type NewsFeedRecordUpdateInput = {
  feedId: string;
  title?: string;
  subscriptionRefs?: string[];
  excludedSubscriptionRefs?: string[];
};

function escapeFilter(value: string) {
  return value.replace(/"/g, '\\"');
}

function itemTime(item: NewsFeedItem): number {
  const value = item?.pubDate;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? 0 : time;
  }
  return 0;
}

function normalizeSubscription(entry: Record<string, unknown> | null): NewsSubscription | null {
  if (!entry) return null;

  const url = String(entry.url ?? entry.feedUrl ?? "").trim();
  if (!url) return null;

  return {
    id: entry.id ? String(entry.id) : undefined,
    url,
    feedUrl: url,
    icon: entry.icon ? String(entry.icon) : "",
    json: entry.json,
    title: String(entry.title ?? entry.name ?? url),
    name: String(entry.title ?? entry.name ?? url),
  };
}

async function getUserFeeds(userId: string): Promise<NewsFeedRecord[]> {
  const feeds = await getAllNewsFeeds(2000);
  return (Array.isArray(feeds) ? feeds : []).filter((feed) => String((feed as Record<string, unknown>).userId || "") === userId);
}

function buildFeedList(feeds: NewsFeedRecord[]) {
  return [
    { id: "all", title: "All feed" },
    ...feeds.filter((feed) => String(feed.id) !== "all" && String(feed.title || "").toLowerCase() !== "all feed").map((feed) => ({
      id: String(feed.id),
      title: String(feed.title || "Untitled feed"),
    })),
  ];
}

async function normalizeNewsFeedUrl(feedUrl: string) {
  const originalFeedUrl = String(feedUrl || "").trim();

  if (!originalFeedUrl) {
    return "";
  }

  if (originalFeedUrl.includes("https://www.youtube.com/@")) {
    const id = await channelId(originalFeedUrl);
    if (id) {
      return `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;
    }
  }

  return originalFeedUrl;
}

function getFeedIcon(feed: Record<string, unknown> | null, fallbackUrl: string) {
  const feedRecord = feed ?? {};
  const image = feedRecord.image && typeof feedRecord.image === "object"
    ? (feedRecord.image as Record<string, unknown>)
    : null;
  const icon = String(image?.url ?? feedRecord.icon ?? "").trim();
  if (icon) {
    return icon;
  }

  return fallbackUrl;
}

export async function getNewsFeedMetadata(feedUrl: string): Promise<NewsFeedMetadata> {
  const normalizedFeedUrl = await normalizeNewsFeedUrl(feedUrl);

  if (!normalizedFeedUrl) {
    return { feedUrl: "", title: "", icon: "" };
  }

  try {
    const parser = new Parser<Record<string, unknown>, NewsFeedItem>({
      customFields: {
        feed: ["image", "icon"],
      },
    });

    const feed = await parser.parseURL(normalizedFeedUrl);
    const title = String(feed?.title || "").trim();
    const icon = getFeedIcon(
      feed,
      (await getFaviconFromDOM(String(feed?.link || normalizedFeedUrl), true)) || "",
    );

    return {
      feedUrl: normalizedFeedUrl,
      title,
      icon: String(icon || "").trim(),
    };
  } catch (error) {
    console.error(`Error fetching feed metadata: ${normalizedFeedUrl}`, error);

    return {
      feedUrl: normalizedFeedUrl,
      title: "",
      icon: (await getFaviconFromDOM(normalizedFeedUrl, true)) || "",
    };
  }
}

function parseCachedItems(raw: unknown): NewsFeedItem[] {
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

function getSubscriptionItems(subscription: NewsSubscription): NewsFeedItem[] {
  return parseCachedItems(subscription.json);
}

function normalizeFeedRecord(entry: Record<string, unknown> | null): NewsFeedRecord | null {
  if (!entry?.id) return null;

  return {
    id: String(entry.id),
    title: String(entry.title ?? "").trim(),
    subscriptionRefs: Array.isArray(entry.subscriptionRefs)
      ? entry.subscriptionRefs.map((value) => String(value).trim()).filter(Boolean)
      : [],
    excludedSubscriptionRefs: Array.isArray(entry.excludedSubscriptionRefs)
      ? entry.excludedSubscriptionRefs.map((value) => String(value).trim()).filter(Boolean)
      : [],
  };
}

async function getAllSubscriptionIdsForUser(userId: string) {
  const subscriptions = await getNewsSubscriptions(userId);
  return Array.from(
    new Set(
      (subscriptions.subscriptions ?? [])
        .map((subscription) => String(subscription.id ?? "").trim())
        .filter(Boolean),
    ),
  );
}

export async function getNewsFeedRecord(userId: string, feedId: string): Promise<NewsFeedRecord | null> {
  const normalizedFeedId = String(feedId || "").trim();
  if (!normalizedFeedId) return null;

  if (normalizedFeedId === "all") {
    const allFeedRecord = await getNewsFeedByTitle(userId, "All feed").catch(() => null);
    if (allFeedRecord) {
      return normalizeFeedRecord(allFeedRecord as Record<string, unknown>);
    }

    return {
      id: "all",
      title: "All feed",
      subscriptionRefs: [],
      excludedSubscriptionRefs: [],
    };
  }

  const feedRecord = await getNewsFeedById(normalizedFeedId).catch(() => null);
  if (!feedRecord) return null;

  const ownerId = String((feedRecord as Record<string, unknown>).userId ?? "").trim();
  if (ownerId && ownerId !== userId) return null;

  return normalizeFeedRecord(feedRecord as Record<string, unknown>);
}

export async function updateNewsFeedRecordForUser(
  userId: string,
  feedId: string,
  payload: Partial<NewsFeedRecordUpdateInput>,
) {
  const normalizedFeedId = String(feedId || "").trim();
  if (!normalizedFeedId) return null;

  const title = String(payload.title ?? "").trim();
  const subscriptionRefs = Array.from(
    new Set((payload.subscriptionRefs ?? []).map((value) => String(value).trim()).filter(Boolean)),
  );
  const excludedSubscriptionRefs = Array.from(
    new Set((payload.excludedSubscriptionRefs ?? []).map((value) => String(value).trim()).filter(Boolean)),
  );

  if (normalizedFeedId === "all") {
    const existingFeed = await getNewsFeedByTitle(userId, "All feed").catch(() => null);
    if (existingFeed?.id) {
      return updateNewsFeedRecord(String(existingFeed.id), {
        title: title || "All feed",
        subscriptionRefs,
        excludedSubscriptionRefs,
      });
    }

    const allSubscriptionRefs = subscriptionRefs.length
      ? subscriptionRefs
      : await getAllSubscriptionIdsForUser(userId);

    return createNewsFeedRecord({
      userId,
      title: title || "All feed",
      subscriptionRefs: allSubscriptionRefs,
      excludedSubscriptionRefs,
    });
  }

  const feedRecord = await getNewsFeedById(normalizedFeedId).catch(() => null);
  if (!feedRecord) return null;

  const ownerId = String((feedRecord as Record<string, unknown>).userId ?? "").trim();
  if (ownerId && ownerId !== userId) return null;

  return updateNewsFeedRecord(normalizedFeedId, {
    title: title || String((feedRecord as Record<string, unknown>).title ?? "").trim(),
    subscriptionRefs,
    excludedSubscriptionRefs,
  });
}

async function getUserSubscriptionIdsFromFeeds(feeds: NewsFeedRecord[]) {
  const ids = new Set<string>();

  for (const feed of feeds) {
    for (const id of feed.subscriptionRefs ?? []) {
      ids.add(String(id));
    }
  }

  return ids;
}

async function getUserExcludedSubscriptionIdsFromFeeds(feeds: NewsFeedRecord[]) {
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
): Promise<string[]> {
  const feeds = await getUserFeeds(userId);
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

  return Array.from(selectedIds);
}

async function buildFeedFromSubscriptions(
  subscriptions: NewsSubscription[],
  feedId?: string | null,
  feeds: NewsFeedRecord[] = [],
) {
  const byId = new Map(subscriptions.filter((subscription) => subscription.id).map((subscription) => [String(subscription.id), subscription] as const));

  const selectByFeed = (feed: NewsFeedRecord) => {
    const refs = new Set((feed.subscriptionRefs ?? []).map(String));
    const exclusions = new Set((feed.excludedSubscriptionRefs ?? []).map(String));
    return subscriptions.filter((subscription) => subscription.id && refs.has(String(subscription.id)) && !exclusions.has(String(subscription.id)));
  };

  let selectedSubscriptions: NewsSubscription[] = subscriptions;

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

  const feed: NewsFeedItem[] = [];

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

export async function getNewsFeed(userId: string, feedId?: string | null): Promise<NewsFeedItem[]> {
  const feeds = await getUserFeeds(userId);
  const subscriptionIds = await getUserSubscriptionIdsFromFeeds(feeds);
  const excludedIds = await getUserExcludedSubscriptionIdsFromFeeds(feeds);

  const allSubscriptions = (await getAllNewsSubscriptions(2000)) as Array<Record<string, unknown>>;
  const subscriptions = allSubscriptions
    .map(normalizeSubscription)
    .filter((entry: NewsSubscription | null): entry is NewsSubscription => Boolean(entry));

  const scopedSubscriptions = subscriptionIds.size
    ? subscriptions.filter((subscription) => subscription.id && subscriptionIds.has(String(subscription.id)) && !excludedIds.has(String(subscription.id)))
    : subscriptions.filter((subscription) => !excludedIds.has(String(subscription.id || "")));

  const feed = await buildFeedFromSubscriptions(scopedSubscriptions, feedId, feeds);
  return feed;
}

export async function getNewsSubscriptions(userId: string): Promise<NewsSubscriptionsResponse> {
  const feeds = await getUserFeeds(userId);
  const subscriptionIds = await getUserSubscriptionIdsFromFeeds(feeds);

  const allSubscriptions = (await getAllNewsSubscriptions(2000)) as Array<Record<string, unknown>>;
  const subscriptions = allSubscriptions
    .map(normalizeSubscription)
    .filter((entry: NewsSubscription | null): entry is NewsSubscription => Boolean(entry));

  const scopedSubscriptions = subscriptionIds.size
    ? subscriptions.filter((subscription) => subscription.id && subscriptionIds.has(String(subscription.id)))
    : subscriptions;

  const subscriptionsWithFeedIds: NewsFeedDraft[] = scopedSubscriptions.map((subscription) => ({
    id: subscription.id,
    url: subscription.url,
    feedUrl: String(subscription.feedUrl ?? subscription.url ?? ""),
    icon: subscription.icon,
    json: subscription.json,
    title: subscription.title,
    name: subscription.name,
    feedIds: feeds
      .filter((feed) => (feed.subscriptionRefs ?? []).map(String).includes(String(subscription.id || "")))
      .map((feed) => String(feed.id)),
    newFeedTitles: subscription.newFeedTitles,
  }));

  return {
    id: null,
    subscriptions: subscriptionsWithFeedIds,
  };
}

export async function getNewsFeeds(userId: string): Promise<NewsFeedsResponse> {
  const feeds = await getUserFeeds(userId);

  return {
    id: null,
    feeds: buildFeedList(feeds),
  };
}

function normalizeRefreshFeedIds(feedIds?: string[] | string | null) {
  if (Array.isArray(feedIds)) {
    return Array.from(new Set(feedIds.map((feedId) => String(feedId).trim()).filter(Boolean)));
  }

  const singleFeedId = String(feedIds || "").trim();
  return singleFeedId ? [singleFeedId] : [];
}

export async function refreshNewsFeed(
  userId: string,
  options?: { feedId?: string | null; feedIds?: string[] | null },
) {
  if (!config.jobs_webhook_enabled) {
    return { message: "Jobs webhook is disabled" };
  }

  const feedIds = normalizeRefreshFeedIds(options?.feedIds ?? options?.feedId ?? null);
  if (!feedIds.length) {
    return { message: "No feed IDs specified" };
  }

  const url = new URL(`${config.jobs_url}/webhook/newsFeedBuilder`);

  for (const feedId of feedIds) {
    url.searchParams.append("feedId", feedId);
  }

  const response = await fetch(url, {
    ...(url.toString().startsWith("https://")
      ? { tls: { rejectUnauthorized: false } }
      : {}),
  } as RequestInit & { tls?: { rejectUnauthorized: boolean } });

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return await response.json();
  }

  return await response.text();
}

export async function subscribeNewsFeed(
  userId: string,
  sub: NewsSubscribeInput,
): Promise<{ message: string }> {
  const originalFeedUrl = sub.feedUrl;
  sub.feedUrl = await normalizeNewsFeedUrl(sub.feedUrl);

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
      const feedIds = await syncSubscriptionFeedRefs(userId, existing.id, sub.feedIds ?? [], sub.newFeedTitles ?? []);

      if (config.jobs_webhook_enabled && feedIds.length > 0) {
        await refreshNewsFeed(userId, { feedIds });
      }
    }
  } else {
    const created = await createNewsSubscription({
      url: sub.feedUrl,
      icon: sub.icon,
      json: [],
    });

    if (created?.id) {
      const feedIds = await syncSubscriptionFeedRefs(userId, created.id, sub.feedIds ?? [], sub.newFeedTitles ?? []);

      if (config.jobs_webhook_enabled && feedIds.length > 0) {
        await refreshNewsFeed(userId, { feedIds });
      }
    }
  }

  return { message: "Feed successfully subscribed." };
}

export async function unsubscribeNewsFeed(userId: string, subscriptionId: string): Promise<{ message: string }> {
  await deleteNewsSubscription(subscriptionId);
  return { message: "Subscription removed." };
}

export async function updateNewsFeed(
  userId: string,
  payload: NewsUpdateInput
): Promise<{ message: string } | { _status: number; error: string }> {
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
