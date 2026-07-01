import Parser from 'rss-parser';
import { channelId } from "@gonetone/get-youtube-id-by-url";
import { config } from "../config";
import { getFaviconFromDOM } from "../api/tools/faviconFromDom";
import type { NewsFeedsRecord, NewsSubscriptionsRecord } from "@dashwise/types";
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
} from "./superuser";
import { getSuperuserPB } from "../pb/pocketbase";

export type NewsFeedItem = {
  title: string;
  link: string;
  pubDate: string | Date;
  subscription_id: string;
  subscription_name: string;
  topicId?: string;
  topicTitle?: string;
  relatedArticles?: NewsFeedItem[];
  [key: string]: unknown;
};

type NewsTopicDraft = {
  key: string;
  title: string;
  articles: NewsFeedItem[];
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
  linkReplaceRule?: Record<string, string>;
  fallbackThumbnailUrl?: string;
  thumbnailOverwriteUrl?: string;
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
  linkReplaceRule?: Record<string, string>;
  fallbackThumbnailUrl?: string;
  thumbnailOverwriteUrl?: string;
};

export type NewsUpdateInput = {
  subscriptionId?: string;
  oldFeedUrl?: string;
  feedUrl: string;
  title?: string;
  icon?: string;
  feedIds?: string[];
  linkReplaceRule?: Record<string, string>;
  fallbackThumbnailUrl?: string;
  thumbnailOverwriteUrl?: string;
};

export type NewsFeedDraft = Omit<NewsSubscription, "feedUrl" | "url"> & {
  feedUrl: string;
  url?: string;
};

export type NewsFeedRecord = Pick<
  NewsFeedsRecord,
  "id" | "title" | "subscriptionRefs" | "excludedSubscriptionRefs"
>;

export type NewsFeedRecordUpdateInput = {
  feedId: string;
} & Pick<NewsFeedsRecord, "title" | "subscriptionRefs" | "excludedSubscriptionRefs">;

export type NewsFeedRecordCreateInput = {
  title: string;
};

export type NewsSavedArticle = {
  id: string;
  list: string[];
  isRead?: boolean;
  json: NewsFeedItem;
  userId?: string;
  created?: string;
  updated?: string;
};

export type NewsSavedArticleList = {
  id: string;
  name: string;
};

export type NewsSavedArticlesResponse = {
  articles: NewsSavedArticle[];
  lists: NewsSavedArticleList[];
  defaultList: string;
};

function escapeFilter(value: string) {
  return value.replace(/"/g, '\\"');
}

function normalizeListName(list?: string | null) {
  return String(list || "").trim() || "readLater";
}

function normalizeListIds(list?: unknown): string[] {
  const values = Array.isArray(list) ? list : list ? [list] : [];
  return Array.from(new Set(values.map((value) => String(value).trim()).filter(Boolean)));
}

function normalizeSavedArticleList(record: Record<string, unknown>): NewsSavedArticleList {
  const name = normalizeListName(String(record.name || ""));
  return {
    id: String(record.id || ""),
    name: name === "readLater" ? "Read Later" : name,
  };
}

function normalizeSavedArticle(record: Record<string, unknown>): NewsSavedArticle {
  return {
    id: String(record.id || ""),
    list: normalizeListIds(record.list),
    isRead: Boolean(record.isRead),
    json: (record.json && typeof record.json === "object" ? record.json : {}) as NewsFeedItem,
    userId: record.userId ? String(record.userId) : undefined,
    created: record.created ? String(record.created) : undefined,
    updated: record.updated ? String(record.updated) : undefined,
  };
}

async function ensureNewsDefaultList(userId: string) {
  const pb = await getSuperuserPB();
  const user = await pb.collection("users").getOne(userId).catch(() => null) as Record<string, unknown> | null;
  const current = user?.newsPreferences && typeof user.newsPreferences === "object"
    ? user.newsPreferences as Record<string, unknown>
    : {};
  const defaultList = normalizeListName(String(current.defaultList || ""));

  if (current.defaultList !== defaultList) {
    await pb.collection("users").update(userId, {
      newsPreferences: { ...current, defaultList },
    });
  }

  return defaultList;
}

async function ensureNewsSavedArticleList(userId: string, list?: string | null): Promise<NewsSavedArticleList> {
  const pb = await getSuperuserPB();
  const target = normalizeListName(list);
  const collection = pb.collection("newsSavedArticleLists");
  const byId = await collection.getOne(target).catch(() => null) as Record<string, unknown> | null;
  if (byId && String(byId.userId || "") === userId) {
    return normalizeSavedArticleList(byId);
  }

  const existing = await collection.getFullList(200, {
    filter: `userId=\"${escapeFilter(userId)}\" && name=\"${escapeFilter(target)}\"`,
  }) as Array<Record<string, unknown>>;

  if (existing[0]) {
    return normalizeSavedArticleList(existing[0]);
  }

  const created = await collection.create({ userId, name: target });
  return normalizeSavedArticleList(created as Record<string, unknown>);
}

async function getNewsSavedArticleLists(userId: string, defaultList: string): Promise<NewsSavedArticleList[]> {
  const defaultRecord = await ensureNewsSavedArticleList(userId, defaultList);
  const pb = await getSuperuserPB();
  const records = await pb.collection("newsSavedArticleLists").getFullList(200, {
    filter: `userId=\"${escapeFilter(userId)}\"`,
    sort: "name",
  }) as Array<Record<string, unknown>>;
  const lists = records.map(normalizeSavedArticleList);
  return lists.some((list) => list.id === defaultRecord.id) ? lists : [defaultRecord, ...lists];
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

function articleKey(item: NewsFeedItem) {
  return String(item.link || item.title || "").trim().toLowerCase();
}

function textValue(value: unknown) {
  if (Array.isArray(value)) return value.join(" ");
  return String(value || "");
}

const topicStopWords = new Set([
  "about", "after", "again", "also", "amid", "because", "before", "being", "could", "from", "have", "into",
  "more", "news", "over", "said", "says", "that", "their", "there", "this", "through", "update", "using", "what",
  "when", "where", "which", "while", "with", "will", "would", "your",
]);

function topicTokens(item: NewsFeedItem) {
  const weighted = [
    textValue(item.title),
    textValue(item.title),
    textValue(item.description),
    textValue(item.summary),
    textValue(item.categories),
    textValue(item.tags),
    textValue(item.categories),
    textValue(item.tags),
  ].join(" ");

  return weighted
    .toLowerCase()
    .replace(/<[^>]*>/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 3 && !topicStopWords.has(token));
}

function uniqueTopicTokens(item: NewsFeedItem) {
  return new Set(topicTokens(item));
}

function similarity(left: NewsFeedItem, right: NewsFeedItem) {
  const leftTokens = uniqueTopicTokens(left);
  const rightTokens = uniqueTopicTokens(right);
  if (!leftTokens.size || !rightTokens.size) return 0;

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap++;
  }

  return overlap / Math.min(leftTokens.size, rightTokens.size);
}

function topicKeyFor(articles: NewsFeedItem[]) {
  const counts = new Map<string, number>();
  for (const article of articles) {
    for (const token of uniqueTopicTokens(article)) {
      counts.set(token, (counts.get(token) || 0) + 1);
    }
  }

  const tokens = Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 5)
    .map(([token]) => token);

  return tokens.join("-") || articleKey(articles[0]);
}

function topicTitleFor(articles: NewsFeedItem[]) {
  const newest = [...articles].sort((left, right) => itemTime(right) - itemTime(left))[0];
  const title = String(newest?.title || "Related stories").trim();
  return title.length > 96 ? `${title.slice(0, 93)}...` : title;
}

function buildNewsTopics(feed: NewsFeedItem[]): NewsTopicDraft[] {
  const topics: NewsTopicDraft[] = [];
  const assigned = new Set<string>();
  const sorted = [...feed].sort((left, right) => itemTime(right) - itemTime(left));

  for (const lead of sorted) {
    const leadKey = articleKey(lead);
    if (!leadKey || assigned.has(leadKey)) continue;

    const related = sorted
      .filter((candidate) => {
        const candidateKey = articleKey(candidate);
        if (!candidateKey || candidateKey === leadKey || assigned.has(candidateKey)) return false;
        if (Math.abs(itemTime(lead) - itemTime(candidate)) > 1000 * 60 * 60 * 72) return false;
        return similarity(lead, candidate) >= 0.35;
      })
      .slice(0, 4);

    if (!related.length) continue;

    const articles = [lead, ...related];
    for (const article of articles) assigned.add(articleKey(article));
    topics.push({
      key: topicKeyFor(articles),
      title: topicTitleFor(articles),
      articles,
    });
  }

  return topics;
}

async function persistNewsTopics(userId: string, topics: NewsTopicDraft[]) {
  const pb = await getSuperuserPB();
  const persisted = new Map<string, Record<string, unknown>>();

  for (const topic of topics) {
    const payload = {
      userId,
      key: topic.key,
      title: topic.title,
      newestArticleLink: String(topic.articles[0]?.link || ""),
      articleLinks: topic.articles.map((article) => String(article.link || "")).filter(Boolean),
      json: topic.articles,
    };

    const existing = await pb.collection("newsTopics").getFirstListItem(
      `userId=\"${escapeFilter(userId)}\" && topicKey=\"${escapeFilter(topic.key)}\"`,
    ).catch(() => null) as Record<string, unknown> | null;
    const record = existing?.id
      ? await pb.collection("newsTopics").update(String(existing.id), payload)
      : await pb.collection("newsTopics").create(payload);
    persisted.set(topic.key, record as Record<string, unknown>);
  }

  return persisted;
}

async function applyNewsTopics(userId: string, feed: NewsFeedItem[]) {
  const topics = buildNewsTopics(feed);
  if (!topics.length) return feed;

  const persisted = await persistNewsTopics(userId, topics).catch(() => new Map<string, Record<string, unknown>>());
  const relatedKeys = new Set<string>();
  const leadByKey = new Map<string, NewsFeedItem>();

  for (const topic of topics) {
    const record = persisted.get(topic.key);
    const topicId = String(record?.id || topic.key);
    const [lead, ...relatedArticles] = topic.articles;
    for (const related of relatedArticles) relatedKeys.add(articleKey(related));
    leadByKey.set(articleKey(lead), {
      ...lead,
      topicId,
      topicTitle: topic.title,
      relatedArticles: relatedArticles.map((article) => ({
        ...article,
        topicId,
        topicTitle: topic.title,
      })),
    });
  }

  return feed
    .filter((article) => !relatedKeys.has(articleKey(article)))
    .map((article) => leadByKey.get(articleKey(article)) ?? article);
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
    linkReplaceRule: entry.linkReplaceRule as Record<string, string> | undefined,
    fallbackThumbnailUrl: entry.fallbackThumbnailUrl ? String(entry.fallbackThumbnailUrl) : undefined,
    thumbnailOverwriteUrl: entry.thumbnailOverwriteUrl ? String(entry.thumbnailOverwriteUrl) : undefined,
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
    const allFeedRecord = (await getNewsFeedByTitle(userId, "All feed").catch(() => null)) as NewsFeedRecord | null;
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

  const feedRecord = (await getNewsFeedById(normalizedFeedId).catch(() => null)) as NewsFeedRecord | null;
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
    const existingFeed = (await getNewsFeedByTitle(userId, "All feed").catch(() => null)) as NewsFeedRecord | null;
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

  const feedRecord = (await getNewsFeedById(normalizedFeedId).catch(() => null)) as NewsFeedRecord | null;
  if (!feedRecord) return null;

  const ownerId = String((feedRecord as Record<string, unknown>).userId ?? "").trim();
  if (ownerId && ownerId !== userId) return null;

  return updateNewsFeedRecord(normalizedFeedId, {
    title: title || String((feedRecord as Record<string, unknown>).title ?? "").trim(),
    subscriptionRefs,
    excludedSubscriptionRefs,
  });
}

export async function createNewsFeedRecordForUser(
  userId: string,
  payload: NewsFeedRecordCreateInput,
): Promise<NewsFeedRecord | null> {
  const title = String(payload.title || "").trim();
  if (!title) {
    return null;
  }

  const existingFeed = (await getNewsFeedByTitle(userId, title).catch(() => null)) as NewsFeedRecord | null;
  if (existingFeed?.id) {
    return normalizeFeedRecord(existingFeed as Record<string, unknown>);
  }

  const createdFeed = (await createNewsFeedRecord({
    userId,
    title,
    subscriptionRefs: [],
    excludedSubscriptionRefs: [],
  })) as NewsFeedRecord;

  return normalizeFeedRecord(createdFeed as Record<string, unknown>);
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

    const existingFeed = (await getNewsFeedByTitle(userId, title).catch(() => null)) as NewsFeedRecord | null;

    if (existingFeed?.id) {
      selectedIds.add(String(existingFeed.id));
      continue;
    }

    const createdFeed = (await createNewsFeedRecord({
      userId,
      title,
      subscriptionRefs: [subscriptionId],
      excludedSubscriptionRefs: [],
    })) as NewsFeedRecord;
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

  const allSubscriptions = (await getAllNewsSubscriptions(2000)) as Array<NewsSubscriptionsRecord>;
  const subscriptions = allSubscriptions
    .map(normalizeSubscription)
    .filter((entry: NewsSubscription | null): entry is NewsSubscription => Boolean(entry));

  const scopedSubscriptions = subscriptionIds.size
    ? subscriptions.filter((subscription) => subscription.id && subscriptionIds.has(String(subscription.id)) && !excludedIds.has(String(subscription.id)))
    : subscriptions.filter((subscription) => !excludedIds.has(String(subscription.id || "")));

  const feed = await buildFeedFromSubscriptions(scopedSubscriptions, feedId, feeds);
  return applyNewsTopics(userId, feed);
}

export async function getNewsSubscriptions(userId: string): Promise<NewsSubscriptionsResponse> {
  const feeds = await getUserFeeds(userId);
  const subscriptionIds = await getUserSubscriptionIdsFromFeeds(feeds);

  const allSubscriptions = (await getAllNewsSubscriptions(2000)) as Array<NewsSubscriptionsRecord>;
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
    linkReplaceRule: subscription.linkReplaceRule,
    fallbackThumbnailUrl: subscription.fallbackThumbnailUrl,
    thumbnailOverwriteUrl: subscription.thumbnailOverwriteUrl,
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

export async function getNewsSavedArticles(userId: string, list?: string | null): Promise<NewsSavedArticlesResponse> {
  const defaultList = await ensureNewsDefaultList(userId);
  const lists = await getNewsSavedArticleLists(userId, defaultList);
  const requestedList = String(list || "").trim();
  const targetList = requestedList
    ? lists.find((entry) => entry.id === requestedList || entry.name === requestedList) ?? null
    : null;
  const pb = await getSuperuserPB();

  const records = await pb.collection("newsSavedArticles").getFullList(2000, {
    filter: `userId=\"${escapeFilter(userId)}\"`,
    sort: "-created",
  }) as Array<Record<string, unknown>>;

  const articles = records
    .map(normalizeSavedArticle)
    .filter((article) => !targetList || article.list.includes(targetList.id));

  return { articles, lists, defaultList: lists.find((entry) => entry.name === defaultList || (defaultList === "readLater" && entry.name === "Read Later"))?.id || lists[0]?.id || defaultList };
}

export async function saveNewsArticle(userId: string, article: NewsFeedItem, list?: string | null): Promise<NewsSavedArticle> {
  const defaultList = await ensureNewsDefaultList(userId);
  const listRecord = await ensureNewsSavedArticleList(userId, list || defaultList);
  const link = String(article?.link || "").trim();
  if (!link) {
    throw new Error("Article link is required");
  }

  const pb = await getSuperuserPB();
  const existingRecords = await pb.collection("newsSavedArticles").getFullList(2000, {
    filter: `userId=\"${escapeFilter(userId)}\"`,
  }) as Array<Record<string, unknown>>;
  const existing = existingRecords.find((record) => {
    const json = record.json && typeof record.json === "object" ? record.json as Record<string, unknown> : {};
    return String(json.link || "").trim() === link;
  }) || null;

  const payload = { userId, list: [listRecord.id], isRead: false, json: article };
  const saved = existing?.id
    ? await pb.collection("newsSavedArticles").update(String(existing.id), payload)
    : await pb.collection("newsSavedArticles").create(payload);

  return normalizeSavedArticle(saved as Record<string, unknown>);
}

export async function deleteNewsSavedArticle(userId: string, link: string): Promise<{ success: boolean; deletedCount: number }> {
  const targetLink = String(link || "").trim();
  if (!targetLink) {
    throw new Error("Article link is required");
  }

  const pb = await getSuperuserPB();
  const records = await pb.collection("newsSavedArticles").getFullList(2000, {
    filter: `userId=\"${escapeFilter(userId)}\"`,
  }) as Array<Record<string, unknown>>;
  const matches = records.filter((record) => {
    const json = record.json && typeof record.json === "object" ? record.json as Record<string, unknown> : {};
    return String(json.link || "").trim() === targetLink;
  });

  await Promise.all(matches.map((record) => pb.collection("newsSavedArticles").delete(String(record.id))));
  return { success: true, deletedCount: matches.length };
}

export async function updateNewsSavedArticleReadState(userId: string, link: string, isRead: boolean): Promise<{ success: boolean; updatedCount: number }> {
  const targetLink = String(link || "").trim();
  if (!targetLink) {
    throw new Error("Article link is required");
  }

  const pb = await getSuperuserPB();
  const records = await pb.collection("newsSavedArticles").getFullList(2000, {
    filter: `userId=\"${escapeFilter(userId)}\"`,
  }) as Array<Record<string, unknown>>;
  const matches = records.filter((record) => {
    const json = record.json && typeof record.json === "object" ? record.json as Record<string, unknown> : {};
    return String(json.link || "").trim() === targetLink;
  });

  await Promise.all(matches.map((record) => pb.collection("newsSavedArticles").update(String(record.id), { isRead })));
  return { success: true, updatedCount: matches.length };
}

export async function deleteNewsSavedArticleList(userId: string, list: string): Promise<{ success: boolean; deletedArticles: number }> {
  const requestedList = String(list || "").trim();
  if (!requestedList) {
    throw new Error("Saved list is required");
  }

  const defaultList = await ensureNewsDefaultList(userId);
  const lists = await getNewsSavedArticleLists(userId, defaultList);
  const targetList = lists.find((entry) => entry.id === requestedList || entry.name === requestedList);
  if (!targetList) {
    return { success: true, deletedArticles: 0 };
  }

  const pb = await getSuperuserPB();
  const records = await pb.collection("newsSavedArticles").getFullList(2000, {
    filter: `userId=\"${escapeFilter(userId)}\"`,
  }) as Array<Record<string, unknown>>;
  const matches = records
    .map(normalizeSavedArticle)
    .filter((article) => article.list.includes(targetList.id));

  await Promise.all(matches.map((article) => pb.collection("newsSavedArticles").delete(article.id)));
  await pb.collection("newsSavedArticleLists").delete(targetList.id);

  return { success: true, deletedArticles: matches.length };
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
  return { message: "Internal refresh triggered" };
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

  const existing = (await getNewsSubscriptionByUrl(sub.feedUrl).catch(() => null)) as NewsSubscription | null;

  if (existing) {
    const subscriptionId = existing.id as string;
    await updateNewsSubscription(subscriptionId, {
      url: sub.feedUrl,
      icon: sub.icon,
      json: existing.json ?? [],
      linkReplaceRule: sub.linkReplaceRule,
      fallbackThumbnailUrl: sub.fallbackThumbnailUrl,
      thumbnailOverwriteUrl: sub.thumbnailOverwriteUrl,
    });

    if (subscriptionId) {
      const feedIds = await syncSubscriptionFeedRefs(userId, subscriptionId, sub.feedIds ?? [], sub.newFeedTitles ?? []);
    }
  } else {
    const created = (await createNewsSubscription({
      url: sub.feedUrl,
      title: sub.name,
      icon: sub.icon,
      json: [],
      linkReplaceRule: sub.linkReplaceRule,
      fallbackThumbnailUrl: sub.fallbackThumbnailUrl,
      thumbnailOverwriteUrl: sub.thumbnailOverwriteUrl,
    })) as NewsSubscription;

    if (created?.id) {
      const feedIds = await syncSubscriptionFeedRefs(userId, created.id, sub.feedIds ?? [], sub.newFeedTitles ?? []);
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
  const target = (payload.subscriptionId
    ? await getNewsSubscriptionById(payload.subscriptionId)
    : payload.oldFeedUrl
      ? await getNewsSubscriptionByUrl(payload.oldFeedUrl)
      : null) as NewsSubscription | null;

  if (!target) {
    return { _status: 404, error: "Subscription not found" };
  }

  const subscriptionId = target.id as string;

  await updateNewsSubscription(subscriptionId, {
    url: payload.feedUrl,
    title: payload.title,
    icon: payload.icon || target.icon || "",
    json: target.json ?? [],
    linkReplaceRule: payload.linkReplaceRule !== undefined ? payload.linkReplaceRule : target.linkReplaceRule,
    fallbackThumbnailUrl: payload.fallbackThumbnailUrl !== undefined ? payload.fallbackThumbnailUrl : target.fallbackThumbnailUrl,
    thumbnailOverwriteUrl: payload.thumbnailOverwriteUrl !== undefined ? payload.thumbnailOverwriteUrl : target.thumbnailOverwriteUrl,
  });

  await syncSubscriptionFeedRefs(userId, subscriptionId, payload.feedIds ?? []);

  return { message: "Subscription updated" };
}

export { updateNewsSubscription };
