import Parser from 'rss-parser';
import { channelId } from "@gonetone/get-youtube-id-by-url";
import { config } from "../config";
import { getFaviconFromDOM } from "../api/tools/faviconFromDom";
import type { NewsSubscriptionsRecord } from "@dashwise/types";
import type {
  NewsFeedDraft,
  NewsFeedItem,
  NewsFeedMetadata,
  NewsFeedRecord,
  NewsFeedRecordCreateInput,
  NewsFeedRecordUpdateInput,
  NewsFeedsResponse,
  NewsFeedSummary,
  NewsSavedArticle,
  NewsSavedArticleList,
  NewsSavedArticlesResponse,
  NewsSubscribeInput,
  NewsSubscriptionsResponse,
  NewsUpdateInput,
} from "@dashwise/types/sdk";
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

type NewsTopicDraft = {
  key: string;
  title: string;
  articles: NewsFeedItem[];
};

type NewsSubscription = {
  id?: string;
  userId?: string;
  url?: string;
  feedUrl?: string;
  name?: string;
  newFeedTitles?: string[];
  linkReplaceRule?: Record<string, string>;
  fallbackThumbnailUrl?: string;
  thumbnailOverwriteUrl?: string;
  similarityGroupingWordsBlacklist?: string;
  enableTopicGrouping?: boolean;
  json?: unknown;
  title?: string;
  icon?: string;
  fetchErrors?: string;
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

function titleWordCount(item: NewsFeedItem) {
  return String(item.title || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .length;
}

const topicStopWords = new Set([
  "able", "about", "after", "again", "also", "amid", "because", "before", "being", "between", "both", "can",
  "could", "does", "from", "have", "into", "just", "more", "news", "over", "said", "says", "that", "their",
  "there", "this", "through", "update", "using", "what", "when", "where", "which", "while", "with", "will",
  "would", "your", "the", "and", "for", "are", "but", "not", "you", "all", "any", "was", "one", "our", "out",
  "day", "get", "has", "him", "his", "how", "its", "may", "new", "now", "old", "see", "two", "who", "why", "via",
  "a", "an", "as", "at", "be", "by", "do", "go", "he", "if", "in", "is", "it", "me", "my", "no", "of", "on", "or",
  "so", "to", "up", "us", "we",
]);

function normalizeBlacklistWord(word: string) {
  return word.toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
}

function parseTopicBlacklist(value?: string | null) {
  const added = new Set<string>();
  const removedDefaults = new Set<string>();

  for (const raw of String(value || "").split(",")) {
    const entry = raw.trim();
    if (!entry) continue;

    const isRemoval = entry.startsWith("-");
    const word = normalizeBlacklistWord(isRemoval ? entry.slice(1) : entry);
    if (!word) continue;

    if (isRemoval) {
      removedDefaults.add(word);
      added.delete(word);
    } else {
      added.add(word);
    }
  }

  return { added, removedDefaults };
}

function effectiveTopicBlacklist(value?: string | null, baseBlacklist: Set<string> = topicStopWords) {
  const { added, removedDefaults } = parseTopicBlacklist(value);
  const blacklist = new Set(Array.from(baseBlacklist).filter((word) => !removedDefaults.has(word)));
  for (const word of added) blacklist.add(word);
  return blacklist;
}

function topicTokens(item: NewsFeedItem, blacklist = topicStopWords) {
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
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !blacklist.has(token));
}

function uniqueTopicTokens(item: NewsFeedItem, blacklist = topicStopWords) {
  return new Set(topicTokens(item, blacklist));
}

function similarity(left: NewsFeedItem, right: NewsFeedItem, blacklists: Map<string, Set<string>>) {
  const leftTokens = uniqueTopicTokens(left, blacklists.get(String(left.subscription_id || "")) ?? topicStopWords);
  const rightTokens = uniqueTopicTokens(right, blacklists.get(String(right.subscription_id || "")) ?? topicStopWords);
  if (!leftTokens.size || !rightTokens.size) return 0;

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap++;
  }

  return overlap / Math.min(leftTokens.size, rightTokens.size);
}

function topicKeyFor(articles: NewsFeedItem[], blacklists: Map<string, Set<string>>) {
  const counts = new Map<string, number>();
  for (const article of articles) {
    for (const token of uniqueTopicTokens(article, blacklists.get(String(article.subscription_id || "")) ?? topicStopWords)) {
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

function buildNewsTopics(feed: NewsFeedItem[], subscriptions: NewsSubscription[], globalBlacklist: Set<string>): NewsTopicDraft[] {
  const topics: NewsTopicDraft[] = [];
  const assigned = new Set<string>();
  const subscriptionsById = new Map(subscriptions.filter((subscription) => subscription.id).map((subscription) => [String(subscription.id), subscription]));
  const blacklists = new Map(subscriptions.map((subscription) => [String(subscription.id || ""), effectiveTopicBlacklist(subscription.similarityGroupingWordsBlacklist, globalBlacklist)]));
  const sorted = [...feed].sort((left, right) => itemTime(right) - itemTime(left));

  for (const lead of sorted) {
    const leadKey = articleKey(lead);
    const leadSubscription = subscriptionsById.get(String(lead.subscription_id || ""));
    if (leadSubscription?.enableTopicGrouping === false) continue;
    if (titleWordCount(lead) < 5) continue;
    if (!leadKey || assigned.has(leadKey)) continue;

    const related = sorted
      .filter((candidate) => {
        const candidateKey = articleKey(candidate);
        const candidateSubscription = subscriptionsById.get(String(candidate.subscription_id || ""));
        if (!candidateKey || candidateKey === leadKey || assigned.has(candidateKey)) return false;
        if (candidateSubscription?.enableTopicGrouping === false) return false;
        if (titleWordCount(candidate) < 5) return false;
        if (Math.abs(itemTime(lead) - itemTime(candidate)) > 1000 * 60 * 60 * 72) return false;
        return similarity(lead, candidate, blacklists) >= 0.35;
      })
      .slice(0, 4);

    if (!related.length) continue;

    const articles = [lead, ...related];
    for (const article of articles) assigned.add(articleKey(article));
    topics.push({
      key: topicKeyFor(articles, blacklists),
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
      topicKey: topic.key,
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

async function getUserTopicBlacklist(userId: string) {
  const pb = await getSuperuserPB();
  const user = await pb.collection("users").getOne(userId).catch(() => null) as Record<string, unknown> | null;
  const preferences = user?.newsPreferences && typeof user.newsPreferences === "object"
    ? user.newsPreferences as Record<string, unknown>
    : {};

  return effectiveTopicBlacklist(String(preferences.similarityGroupingWordsBlacklist || ""));
}

export async function applyNewsTopics(userId: string, feed: NewsFeedItem[], subscriptions: NewsSubscription[]) {
  const globalBlacklist = await getUserTopicBlacklist(userId).catch(() => topicStopWords);
  const topics = buildNewsTopics(feed, subscriptions, globalBlacklist);
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
    id: String(entry.id || ""),
    userId: entry.userId ? String(entry.userId) : undefined,
    url,
    feedUrl: url,
    icon: entry.icon ? String(entry.icon) : "",
    json: entry.json,
    title: String(entry.title ?? entry.name ?? url),
    name: String(entry.title ?? entry.name ?? url),
    linkReplaceRule: entry.linkReplaceRule as Record<string, string> | undefined,
    fallbackThumbnailUrl: entry.fallbackThumbnailUrl ? String(entry.fallbackThumbnailUrl) : undefined,
    thumbnailOverwriteUrl: entry.thumbnailOverwriteUrl ? String(entry.thumbnailOverwriteUrl) : undefined,
    similarityGroupingWordsBlacklist: entry.similarityGroupingWordsBlacklist ? String(entry.similarityGroupingWordsBlacklist) : "",
    enableTopicGrouping: entry.enableTopicGrouping !== false,
    fetchErrors: entry.fetchErrors ? String(entry.fetchErrors) : "",
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

const FEED_REQUEST_HEADERS = {
  "User-Agent": "Dashwise RSS Reader (+https://github.com/andrew-d/dashwise)",
  "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
};

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
      headers: FEED_REQUEST_HEADERS,
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

export function normalizeMaxFeedItems(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 200;
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
    maxFeedItems: normalizeMaxFeedItems(entry.maxFeedItems),
    feedCache: parseCachedItems(entry.feedCache),
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
      maxFeedItems: 200,
      feedCache: [],
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
  const maxFeedItems = normalizeMaxFeedItems(payload.maxFeedItems);

  if (normalizedFeedId === "all") {
    const existingFeed = (await getNewsFeedByTitle(userId, "All feed").catch(() => null)) as NewsFeedRecord | null;
    if (existingFeed?.id) {
      return updateNewsFeedRecord(String(existingFeed.id), {
        title: title || "All feed",
        subscriptionRefs,
        excludedSubscriptionRefs,
        maxFeedItems,
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
      maxFeedItems,
      feedCache: [],
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
    maxFeedItems,
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
    maxFeedItems: 200,
    feedCache: [],
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

export async function getNewsFeed(
  userId: string,
  feedId?: string | null,
  options?: { limit?: number },
): Promise<{ items: NewsFeedItem[]; total: number; limit: number }> {
  const feeds = await getUserFeeds(userId);
  const selectedFeed = feedId && feedId !== "all"
    ? feeds.find((feed) => String(feed.id) === String(feedId))
    : feeds.find((feed) => String(feed.id) === "all" || String(feed.title || "").toLowerCase() === "all feed");
  const subscriptionIds = await getUserSubscriptionIdsFromFeeds(feeds);
  const excludedIds = await getUserExcludedSubscriptionIdsFromFeeds(feeds);

  const allSubscriptions = (await getAllNewsSubscriptions(2000)) as Array<NewsSubscriptionsRecord>;
  const subscriptions = allSubscriptions
    .map(normalizeSubscription)
    .filter((entry: NewsSubscription | null): entry is NewsSubscription => Boolean(entry && (!entry.userId || entry.userId === userId)));

  const scopedSubscriptions = subscriptionIds.size
    ? subscriptions.filter((subscription) => subscription.id && subscriptionIds.has(String(subscription.id)) && !excludedIds.has(String(subscription.id)))
    : subscriptions.filter((subscription) => !excludedIds.has(String(subscription.id || "")));

  const feed = await buildFeedFromSubscriptions(scopedSubscriptions, feedId, feeds);
  const limit = Number.isFinite(Number(options?.limit)) && Number(options?.limit) > 0
    ? Math.floor(Number(options?.limit))
    : 50;
  const cachedItems = parseCachedItems((selectedFeed as Record<string, unknown> | undefined)?.feedCache);
  if (cachedItems.length) {
    return {
      items: cachedItems.slice(0, limit),
      total: cachedItems.length,
      limit,
    };
  }
  const items = await applyNewsTopics(userId, feed, scopedSubscriptions);

  return {
    items: items.slice(0, limit),
    total: items.length,
    limit,
  };
}

export async function getNewsSubscriptions(userId: string): Promise<NewsSubscriptionsResponse> {
  const feeds = await getUserFeeds(userId);
  const subscriptionIds = await getUserSubscriptionIdsFromFeeds(feeds);

  const allSubscriptions = (await getAllNewsSubscriptions(2000)) as Array<NewsSubscriptionsRecord>;
  const subscriptions = allSubscriptions
    .map(normalizeSubscription)
    .filter((entry: NewsSubscription | null): entry is NewsSubscription => Boolean(entry && (!entry.userId || entry.userId === userId)));

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
    similarityGroupingWordsBlacklist: subscription.similarityGroupingWordsBlacklist,
    enableTopicGrouping: subscription.enableTopicGrouping !== false,
    fetchErrors: subscription.fetchErrors,
  }));

  return {
    id: null,
    subscriptions: subscriptionsWithFeedIds,
  };
}

export async function getNewsFeeds(userId: string): Promise<NewsFeedsResponse> {
  const feeds = await getUserFeeds(userId);
  const allSubscriptions = (await getAllNewsSubscriptions(2000)) as Array<NewsSubscriptionsRecord>;
  const subscriptions = allSubscriptions
    .map(normalizeSubscription)
    .filter((entry: NewsSubscription | null): entry is NewsSubscription => Boolean(entry && (!entry.userId || entry.userId === userId)))
    .map((subscription) => ({
      id: String(subscription.id || subscription.url),
      title: String(subscription.title || subscription.name || subscription.url || "Untitled feed"),
    }));

  return {
    id: null,
    feeds: buildFeedList(feeds),
    subscriptions,
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

  const existingByUrl = (await getNewsSubscriptionByUrl(sub.feedUrl).catch(() => null)) as NewsSubscription | null;
  const existing = existingByUrl && (!existingByUrl.userId || existingByUrl.userId === userId) ? existingByUrl : null;

  if (existing) {
    const subscriptionId = existing.id as string;
    await updateNewsSubscription(subscriptionId, {
      userId,
      url: sub.feedUrl,
      icon: sub.icon,
      json: existing.json ?? [],
      linkReplaceRule: sub.linkReplaceRule,
      fallbackThumbnailUrl: sub.fallbackThumbnailUrl,
      thumbnailOverwriteUrl: sub.thumbnailOverwriteUrl,
      similarityGroupingWordsBlacklist: sub.similarityGroupingWordsBlacklist,
      enableTopicGrouping: sub.enableTopicGrouping !== false,
    });

    if (subscriptionId) {
      const feedIds = await syncSubscriptionFeedRefs(userId, subscriptionId, sub.feedIds ?? [], sub.newFeedTitles ?? []);
    }
  } else {
    const created = (await createNewsSubscription({
      userId,
      url: sub.feedUrl,
      title: sub.name,
      icon: sub.icon,
      json: [],
      linkReplaceRule: sub.linkReplaceRule,
      fallbackThumbnailUrl: sub.fallbackThumbnailUrl,
      thumbnailOverwriteUrl: sub.thumbnailOverwriteUrl,
      similarityGroupingWordsBlacklist: sub.similarityGroupingWordsBlacklist,
      enableTopicGrouping: sub.enableTopicGrouping !== false,
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

  if (target.userId && target.userId !== userId) {
    return { _status: 404, error: "Subscription not found" };
  }

  const subscriptionId = target.id as string;

  await updateNewsSubscription(subscriptionId, {
    userId,
    url: payload.feedUrl,
    title: payload.title,
    icon: payload.icon || target.icon || "",
    json: target.json ?? [],
    linkReplaceRule: payload.linkReplaceRule !== undefined ? payload.linkReplaceRule : target.linkReplaceRule,
    fallbackThumbnailUrl: payload.fallbackThumbnailUrl !== undefined ? payload.fallbackThumbnailUrl : target.fallbackThumbnailUrl,
    thumbnailOverwriteUrl: payload.thumbnailOverwriteUrl !== undefined ? payload.thumbnailOverwriteUrl : target.thumbnailOverwriteUrl,
    similarityGroupingWordsBlacklist: payload.similarityGroupingWordsBlacklist !== undefined ? payload.similarityGroupingWordsBlacklist : target.similarityGroupingWordsBlacklist,
    enableTopicGrouping: payload.enableTopicGrouping !== undefined ? payload.enableTopicGrouping !== false : target.enableTopicGrouping !== false,
  });

  await syncSubscriptionFeedRefs(userId, subscriptionId, payload.feedIds ?? []);

  return { message: "Subscription updated" };
}

export { updateNewsSubscription };
