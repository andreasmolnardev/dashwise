import Parser from 'rss-parser';
import { createHash } from 'node:crypto';
import { channelId } from "@gonetone/get-youtube-id-by-url";
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
  NewsSavedArticle,
  NewsSavedArticleList,
  NewsSavedArticlesResponse,
  NewsSubscribeInput,
  NewsSubscriptionsResponse,
  NewsUpdateInput,
} from "@dashwise/types/sdk";
import {
  deleteNewsSubscription,
  getAllNewsSubscriptions,
  getNewsFeedById,
  getNewsFeedByTitle,
  getNewsFeedBySystemKey,
  getNewsFeedsByUserId,
  getNewsSubscriptionById,
  getNewsSubscriptionByUrl,
  createNewsFeedRecord,
  updateNewsFeedRecord,
  updateNewsSubscription,
  createNewsSubscription,
} from "./superuser";
import { getSuperuserPB } from "../pb/pocketbase";
import {
  deleteSubscriptionArticleIndex,
  readFeedItemsCache,
  readMaterializedFeedItems,
  readMaterializedFeedPage,
} from "../cache/feed-items";

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

type NewsFeedRecordWithSystemFields = NewsFeedRecord & {
  feedType?: "all" | "custom" | string;
  systemKey?: string;
};

export type { NewsSubscription };

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

export function itemTime(item: NewsFeedItem): number {
  const value = item?.pubDate;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? 0 : time;
  }
  return 0;
}

export function canonicalizeArticleUrl(value: string) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    const url = new URL(raw);
    url.hostname = url.hostname.toLowerCase();
    url.hash = "";
    const tracking = url.search.slice(1).split("&").map((part) => {
      const rawKey = part.split("=", 1)[0] || "";
      try {
        return decodeURIComponent(rawKey.replace(/\+/g, " "));
      } catch {
        return rawKey;
      }
    }).filter((key) => /^utm_/i.test(key) || ["fbclid", "gclid", "mc_cid", "mc_eid"].includes(key.toLowerCase()));
    for (const key of tracking) url.searchParams.delete(key);
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch {
    return raw.toLowerCase().replace(/#.*$/, "").replace(/\/+$/, "");
  }
}

function normalizedGuid(item: NewsFeedItem) {
  return String(item.guid || item.id || (item as Record<string, unknown>)["dc:identifier"] || "").trim().toLowerCase();
}

export function articleKey(item: NewsFeedItem, sourceUrl = "") {
  const canonicalUrl = canonicalizeArticleUrl(String(item.link || ""));
  if (canonicalUrl) return `url:${canonicalUrl}`;

  const guid = normalizedGuid(item);
  if (guid) return `guid:${guid}`;

  const title = String(item.title || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!title) return "";
  let sourceHost = String((item as Record<string, unknown>).sourceHost || "").trim().toLowerCase();
  if (!sourceHost) {
    try {
      sourceHost = new URL(sourceUrl || String((item as Record<string, unknown>).source || "")).hostname.toLowerCase();
    } catch {
      sourceHost = String((item as Record<string, unknown>).source || "").trim().toLowerCase();
    }
  }
  const publishedAt = new Date(String(item.pubDate || "")).getTime() || 0;
  return `fallback:${createHash("sha256").update(`${title}|${sourceHost}|${publishedAt}`).digest("hex")}`;
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

export function buildNewsTopics(feed: NewsFeedItem[], subscriptions: NewsSubscription[], globalBlacklist: Set<string>): NewsTopicDraft[] {
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

export function normalizeSubscription(entry: Record<string, unknown> | null): NewsSubscription | null {
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
  const feeds = await getNewsFeedsByUserId(userId, 2000, {
    fields: "id,userId,subscriptionRefs,includedFeedRefs,title,icon,excludedSubscriptionRefs,maxFeedItems,feedType,systemKey",
  });
  return Array.isArray(feeds) ? feeds as NewsFeedRecord[] : [];
}

function buildFeedList(feeds: NewsFeedRecord[]) {
  const allFeed = feeds.find((feed) => isAllNewsFeed(feed));

  return [
    { id: "all", title: "All feed", icon: String(allFeed?.icon || "").trim() },
    ...feeds.filter((feed) => !isAllNewsFeed(feed)).map((feed) => ({
      id: String(feed.id),
      title: String(feed.title || "Untitled feed"),
      icon: String(feed.icon || "").trim(),
      includedFeedRefs: Array.isArray(feed.includedFeedRefs)
        ? feed.includedFeedRefs.map(String).filter(Boolean)
        : [],
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

export function normalizeMaxFeedItems(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 200;
}

function normalizeFeedRecord(entry: Record<string, unknown> | null): NewsFeedRecord | null {
  if (!entry?.id) return null;

  return {
    id: String(entry.id),
    title: String(entry.title ?? "").trim(),
    icon: String(entry.icon ?? "").trim(),
    subscriptionRefs: Array.isArray(entry.subscriptionRefs)
      ? entry.subscriptionRefs.map((value) => String(value).trim()).filter(Boolean)
      : [],
    excludedSubscriptionRefs: Array.isArray(entry.excludedSubscriptionRefs)
      ? entry.excludedSubscriptionRefs.map((value) => String(value).trim()).filter(Boolean)
      : [],
    includedFeedRefs: Array.isArray(entry.includedFeedRefs)
      ? entry.includedFeedRefs.map((value) => String(value).trim()).filter(Boolean)
      : [],
    maxFeedItems: normalizeMaxFeedItems(entry.maxFeedItems),
    feedType: entry.feedType ? String(entry.feedType) : undefined,
    systemKey: entry.systemKey ? String(entry.systemKey) : undefined,
  };
}

export function isAllNewsFeed(entry: Record<string, unknown> | NewsFeedRecordWithSystemFields | null | undefined) {
  if (!entry) return false;
  return String(entry.feedType || "").toLowerCase() === "all" ||
    String(entry.systemKey || "").toLowerCase() === "all" ||
    String(entry.id || "") === "all" ||
    String(entry.title || "").trim().toLowerCase() === "all feed";
}

export async function getNewsFeedRecord(userId: string, feedId: string): Promise<NewsFeedRecord | null> {
  const normalizedFeedId = String(feedId || "").trim();
  if (!normalizedFeedId) return null;

  if (normalizedFeedId === "all") {
    const allFeedRecord = (await getNewsFeedBySystemKey(userId, "all").catch(() => null) ||
      await getNewsFeedByTitle(userId, "All feed").catch(() => null)) as NewsFeedRecord | null;
    if (allFeedRecord) {
      const normalized = normalizeFeedRecord(allFeedRecord as Record<string, unknown>);
      return normalized
        ? { ...normalized, feedType: "all", systemKey: "all", feedCache: (await readMaterializedFeedItems(userId, "all") || []) as NewsFeedItem[] }
        : null;
    }

    return {
      id: "all",
      title: "All feed",
      feedType: "all",
      systemKey: "all",
      subscriptionRefs: [],
      includedFeedRefs: [],
      excludedSubscriptionRefs: [],
      maxFeedItems: 200,
    };
  }

  const feedRecord = (await getNewsFeedById(normalizedFeedId).catch(() => null)) as NewsFeedRecord | null;
  if (!feedRecord) return null;

  const ownerId = String((feedRecord as Record<string, unknown>).userId ?? "").trim();
  if (ownerId && ownerId !== userId) return null;

  const normalized = normalizeFeedRecord(feedRecord as Record<string, unknown>);
  return normalized
    ? { ...normalized, feedCache: (await readMaterializedFeedItems(userId, String(normalized.id)) || []) as NewsFeedItem[] }
    : null;
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
    new Set((payload.subscriptionRefs ?? []).map((value: string) => String(value).trim()).filter(Boolean)),
  );
  const excludedSubscriptionRefs = Array.from(
    new Set((payload.excludedSubscriptionRefs ?? []).map((value: string) => String(value).trim()).filter(Boolean)),
  );
  const maxFeedItems = normalizeMaxFeedItems(payload.maxFeedItems);
  const icon = payload.icon === undefined ? undefined : String(payload.icon).trim();

  if (normalizedFeedId === "all") {
    const existingFeed = (await getNewsFeedBySystemKey(userId, "all").catch(() => null) ||
      await getNewsFeedByTitle(userId, "All feed").catch(() => null)) as NewsFeedRecord | null;
    if (existingFeed?.id) {
      const updated = await updateNewsFeedRecord(String(existingFeed.id), {
        title: title || "All feed",
        feedType: "all",
        systemKey: "all",
        ...(icon === undefined ? {} : { icon }),
        subscriptionRefs: [],
        includedFeedRefs: [],
        excludedSubscriptionRefs,
        maxFeedItems,
      });
      void rebuildNewsViews(userId).catch(() => undefined);
      return updated;
    }

    const created = await createNewsFeedRecord({
      userId,
      title: title || "All feed",
      feedType: "all",
      systemKey: "all",
      ...(icon === undefined ? {} : { icon }),
      subscriptionRefs: [],
      includedFeedRefs: [],
      excludedSubscriptionRefs,
      maxFeedItems,
    });
    void rebuildNewsViews(userId).catch(() => undefined);
    return created;
  }

  const feedRecord = (await getNewsFeedById(normalizedFeedId).catch(() => null)) as NewsFeedRecord | null;
  if (!feedRecord) return null;

  const ownerId = String((feedRecord as Record<string, unknown>).userId ?? "").trim();
  if (ownerId && ownerId !== userId) return null;

  const requestedIncludedFeedRefs = Array.from(
    new Set((payload.includedFeedRefs ?? (feedRecord.includedFeedRefs ?? []))
      .map((value: string) => String(value).trim()).filter(Boolean)),
  );

  const userFeeds = await getUserFeeds(userId);
  const availableFeedIds = new Set(userFeeds
    .filter((feed) => !isAllNewsFeed(feed) && String(feed.id) !== normalizedFeedId)
    .map((feed) => String(feed.id)));
  const includedFeedRefs = requestedIncludedFeedRefs.filter((feedId) => availableFeedIds.has(feedId));
  const feedById = new Map(userFeeds.map((feed) => [String(feed.id), feed]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const hasCycle = (currentId: string): boolean => {
    if (visiting.has(currentId)) return true;
    if (visited.has(currentId)) return false;
    visiting.add(currentId);
    const current = currentId === normalizedFeedId
      ? { includedFeedRefs }
      : feedById.get(currentId);
    for (const childId of current?.includedFeedRefs ?? []) {
      if (childId === "all" || hasCycle(String(childId))) return true;
    }
    visiting.delete(currentId);
    visited.add(currentId);
    return false;
  };
  if (hasCycle(normalizedFeedId)) {
    throw new Error("Feed hierarchy cannot contain cycles");
  }

  const updated = await updateNewsFeedRecord(normalizedFeedId, {
    title: title || String((feedRecord as Record<string, unknown>).title ?? "").trim(),
    feedType: "custom",
    ...(icon === undefined ? {} : { icon }),
    subscriptionRefs,
    includedFeedRefs,
    excludedSubscriptionRefs,
    maxFeedItems,
  });
  void rebuildNewsViews(userId).catch(() => undefined);
  return updated;
}

export async function createNewsFeedRecordForUser(
  userId: string,
  payload: NewsFeedRecordCreateInput,
): Promise<NewsFeedRecord | null> {
  const title = String(payload.title || "").trim();
  if (!title) {
    return null;
  }

  if (title.toLowerCase() === "all feed") {
    return updateNewsFeedRecordForUser(userId, "all", {
      title: "All feed",
      feedType: "all",
      systemKey: "all",
      subscriptionRefs: [],
      includedFeedRefs: [],
      excludedSubscriptionRefs: [],
      maxFeedItems: 200,
    }) as Promise<NewsFeedRecord | null>;
  }

  const existingFeed = (await getNewsFeedByTitle(userId, title).catch(() => null)) as NewsFeedRecord | null;
  if (existingFeed?.id) {
    return normalizeFeedRecord(existingFeed as Record<string, unknown>);
  }

  const createdFeed = (await createNewsFeedRecord({
    userId,
    title,
    feedType: "custom",
    icon: String(payload.icon ?? "").trim(),
    subscriptionRefs: [],
    includedFeedRefs: [],
    excludedSubscriptionRefs: [],
    maxFeedItems: 200,
  })) as NewsFeedRecord;

  void rebuildNewsViews(userId).catch(() => undefined);
  return normalizeFeedRecord(createdFeed as Record<string, unknown>);
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
      feedType: "custom",
      subscriptionRefs: [subscriptionId],
      includedFeedRefs: [],
      excludedSubscriptionRefs: [],
    })) as NewsFeedRecord;
    selectedIds.add(String(createdFeed.id));
  }

  for (const feed of feeds) {
    const feedId = String(feed.id || "");
    if (!feedId) continue;
    if (isAllNewsFeed(feed)) continue;

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

export async function getNewsFeed(
  userId: string,
  feedId?: string | null,
  options?: { limit?: number; offset?: number },
): Promise<{ items: NewsFeedItem[]; total: number; limit: number }> {
  const limit = Number.isFinite(Number(options?.limit)) && Number(options?.limit) > 0
    ? Math.floor(Number(options?.limit))
    : 50;
  const offset = Number.isFinite(Number(options?.offset)) && Number(options?.offset) >= 0
    ? Math.floor(Number(options?.offset))
    : 0;

  const normalizedFeedId = String(feedId || "all").trim() || "all";
  const materializedFeedId = normalizedFeedId === "all" ? "all" : normalizedFeedId;
  let page = await readMaterializedFeedPage(userId, materializedFeedId, offset, limit);

  if (!page.exists) {
    // Redis/Valkey can be flushed independently of PocketBase. Rebuild only
    // this user's views on a cold cache, with a per-user single-flight guard.
    const pending = newsFeedRebuilds.get(userId) || (async () => {
      const { newsFeedBuilder } = await import("../../jobs/news/feed-builder");
      await newsFeedBuilder(undefined, { userId });
    })();
    newsFeedRebuilds.set(userId, pending);
    try {
      await pending;
    } catch {
      // Preserve the API shape; the scheduled builder can retry later.
    } finally {
      if (newsFeedRebuilds.get(userId) === pending) newsFeedRebuilds.delete(userId);
    }
    page = await readMaterializedFeedPage(userId, materializedFeedId, offset, limit);
  }

  return { items: page.items as NewsFeedItem[], total: page.total, limit };
}

const newsFeedRebuilds = new Map<string, Promise<void>>();

export async function getNewsSubscriptions(userId: string): Promise<NewsSubscriptionsResponse> {
  const feeds = await getUserFeeds(userId);

  const allSubscriptions = (await getAllNewsSubscriptions(2000, {
    fields: "id,url,icon,title,linkReplaceRule,fallbackThumbnailUrl,thumbnailOverwriteUrl,userId,similarityGroupingWordsBlacklist,enableTopicGrouping,fetchErrors",
  })) as Array<NewsSubscriptionsRecord>;
  const subscriptions = allSubscriptions
    .map(normalizeSubscription)
    .filter((entry: NewsSubscription | null): entry is NewsSubscription => Boolean(entry && (!entry.userId || entry.userId === userId)));

  const scopedSubscriptions = subscriptions;

  const subscriptionsWithFeedIds: NewsFeedDraft[] = scopedSubscriptions.map((subscription) => ({
    id: subscription.id,
    url: subscription.url,
    feedUrl: String(subscription.feedUrl ?? subscription.url ?? ""),
    icon: subscription.icon,
    title: subscription.title,
    name: subscription.name,
    feedIds: feeds
      .filter((feed) => !isAllNewsFeed(feed) && (feed.subscriptionRefs ?? []).map(String).includes(String(subscription.id || "")))
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

export async function getNewsSubscriptionJson(userId: string, subscriptionId: string): Promise<{ id: string; json: unknown }> {
  const subscriptions = await getNewsSubscriptions(userId);
  const subscription = subscriptions.subscriptions.find((entry: NewsFeedDraft) => String(entry.id || "") === subscriptionId);
  if (!subscription?.id) {
    throw new Error("News subscription not found");
  }

  const json = await readFeedItemsCache(subscription.id);

  return {
    id: subscription.id,
    json: json ?? [],
  };
}

export async function getNewsFeeds(userId: string): Promise<NewsFeedsResponse> {
  const feeds = await getUserFeeds(userId);
  const allSubscriptions = (await getAllNewsSubscriptions(2000, {
    fields: "id,url,title,userId",
  })) as Array<NewsSubscriptionsRecord>;
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

export async function renameNewsSavedArticleList(userId: string, list: string, name: string): Promise<NewsSavedArticleList> {
  const requestedList = String(list || "").trim();
  const nextName = String(name || "").trim();
  if (!requestedList) throw new Error("Saved list is required");
  if (!nextName) throw new Error("Saved list name is required");

  const defaultList = await ensureNewsDefaultList(userId);
  const lists = await getNewsSavedArticleLists(userId, defaultList);
  const targetList = lists.find((entry) => entry.id === requestedList || entry.name === requestedList);
  if (!targetList) throw new Error("Saved list not found");

  const pb = await getSuperuserPB();
  const existing = await pb.collection("newsSavedArticleLists").getFullList(200, {
    filter: `userId=\"${escapeFilter(userId)}\" && name=\"${escapeFilter(nextName)}\"`,
  }) as Array<Record<string, unknown>>;
  if (existing.some((record) => String(record.id || "") !== targetList.id)) {
    throw new Error("A saved list with that name already exists");
  }

  const renamed = await pb.collection("newsSavedArticleLists").update(targetList.id, { name: nextName });
  if (defaultList === targetList.name || (defaultList === "readLater" && targetList.name === "Read Later")) {
    const user = await pb.collection("users").getOne(userId).catch(() => null) as Record<string, unknown> | null;
    const current = user?.newsPreferences && typeof user.newsPreferences === "object"
      ? user.newsPreferences as Record<string, unknown>
      : {};
    await pb.collection("users").update(userId, {
      newsPreferences: { ...current, defaultList: nextName },
    });
  }

  return normalizeSavedArticleList(renamed as Record<string, unknown>);
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
  const ids = normalizeRefreshFeedIds(options?.feedIds?.length ? options.feedIds : options?.feedId);
  const { newsFeedBuilder } = await import("../../jobs/news/feed-builder");
  if (!ids.length) await newsFeedBuilder(undefined, { userId });
  else await newsFeedBuilder(undefined, { userId, feedIds: ids });
  return { message: "Internal refresh triggered" };
}

export async function rebuildNewsViews(userId: string, feedId?: string) {
  const { newsFeedBuilder } = await import("../../jobs/news/feed-builder");
  return newsFeedBuilder(feedId, { userId });
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

  void rebuildNewsViews(userId).catch(() => undefined);

  return { message: "Feed successfully subscribed." };
}

export async function unsubscribeNewsFeed(userId: string, subscriptionId: string): Promise<{ message: string }> {
  const target = (await getNewsSubscriptionById(subscriptionId).catch(() => null) ||
    await getNewsSubscriptionByUrl(subscriptionId).catch(() => null)) as NewsSubscription | null;
  if (target?.id && (!target.userId || target.userId === userId)) {
    await deleteSubscriptionArticleIndex(String(target.id));
    await deleteNewsSubscription(String(target.id));
  }
  void rebuildNewsViews(userId).catch(() => undefined);
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
    linkReplaceRule: payload.linkReplaceRule !== undefined ? payload.linkReplaceRule : target.linkReplaceRule,
    fallbackThumbnailUrl: payload.fallbackThumbnailUrl !== undefined ? payload.fallbackThumbnailUrl : target.fallbackThumbnailUrl,
    thumbnailOverwriteUrl: payload.thumbnailOverwriteUrl !== undefined ? payload.thumbnailOverwriteUrl : target.thumbnailOverwriteUrl,
    similarityGroupingWordsBlacklist: payload.similarityGroupingWordsBlacklist !== undefined ? payload.similarityGroupingWordsBlacklist : target.similarityGroupingWordsBlacklist,
    enableTopicGrouping: payload.enableTopicGrouping !== undefined ? payload.enableTopicGrouping !== false : target.enableTopicGrouping !== false,
  });

  await syncSubscriptionFeedRefs(userId, subscriptionId, payload.feedIds ?? []);
  void rebuildNewsViews(userId, subscriptionId).catch(() => undefined);

  return { message: "Subscription updated" };
}

export { updateNewsSubscription };
