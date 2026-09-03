import { RedisClient } from "bun";
import { config } from "../config";

export type CachedArticle = {
  dedupeKey: string;
  canonicalUrl?: string;
  guid?: string;
  title: string;
  publishedAt: number;
  json: Record<string, unknown>;
  sourceIds?: string[];
};

export type MaterializedFeedItem = {
  id: string;
  score: number;
  json: Record<string, unknown>;
};

export type FeedCacheMetadata = {
  builtAt: string;
  revision: string;
  itemCount: number;
  sourceRevision: string;
};

const redisUrl = Bun.env.REDIS_URL || Bun.env.VALKEY_URL || "redis://127.0.0.1:6379";
const client = config.USE_LOCAL_FEED_CACHE ? null : new RedisClient(redisUrl);

const localArticles = new Map<string, CachedArticle>();
const localArticleSources = new Map<string, Set<string>>();
const localSubscriptionIndexes = new Map<string, Map<string, number>>();
const localViews = new Map<string, { order: Map<string, number>; items: Map<string, string> }>();
const localMetadata = new Map<string, FeedCacheMetadata>();

const toStringValue = (value: unknown) => value == null ? "" : String(value);

async function command(commandName: string, args: string[]): Promise<any> {
  return client!.send(commandName, args);
}

export function articleDocumentKey(dedupeKey: string) {
  return `news:article:${dedupeKey}`;
}

export function articleSourcesKey(dedupeKey: string) {
  return `${articleDocumentKey(dedupeKey)}:sources`;
}

export function subscriptionArticlesKey(subscriptionId: string) {
  return `news:subscription:${subscriptionId}:articles`;
}

export function materializedFeedOrderKey(userId: string, feedId: string) {
  return `news:user:${userId}:feed:${feedId}:order`;
}

export function materializedFeedItemsKey(userId: string, feedId: string) {
  return `news:user:${userId}:feed:${feedId}:items`;
}

export function materializedFeedMetaKey(userId: string, feedId: string) {
  return `news:user:${userId}:feed:${feedId}:meta`;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function parseRedisHash(raw: unknown): Record<string, string> | null {
  if (Array.isArray(raw)) {
    const result: Record<string, string> = {};
    for (let index = 0; index < raw.length; index += 2) {
      if (raw[index] != null) result[toStringValue(raw[index])] = toStringValue(raw[index + 1]);
    }
    return result;
  }
  if (!raw || typeof raw !== "object") return null;
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).map(([key, value]) => [key, toStringValue(value)]));
}

function subscriptionIndexEntries(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(toStringValue).filter(Boolean);
}

async function readArticle(dedupeKey: string): Promise<CachedArticle | null> {
  if (config.USE_LOCAL_FEED_CACHE) return localArticles.get(dedupeKey) ?? null;

  const hash = parseRedisHash(await command("HGETALL", [articleDocumentKey(dedupeKey)]));
  if (!hash?.json) return null;
  return {
    dedupeKey,
    canonicalUrl: hash.canonicalUrl || undefined,
    guid: hash.guid || undefined,
    title: hash.title || "",
    publishedAt: Number(hash.publishedAt) || 0,
    json: parseJson<Record<string, unknown>>(hash.json, {}),
  };
}

async function readArticleSources(dedupeKey: string): Promise<string[]> {
  if (config.USE_LOCAL_FEED_CACHE) return Array.from(localArticleSources.get(dedupeKey) ?? []);
  return subscriptionIndexEntries(await command("SMEMBERS", [articleSourcesKey(dedupeKey)]));
}

export async function readSubscriptionArticles(subscriptionId: string): Promise<CachedArticle[]> {
  const id = String(subscriptionId || "").trim();
  if (!id) return [];

  if (config.USE_LOCAL_FEED_CACHE) {
    const entries = Array.from(localSubscriptionIndexes.get(id)?.entries() ?? [])
      .sort((left, right) => right[1] - left[1]);
    const articles: CachedArticle[] = [];
    for (const [dedupeKey] of entries) {
      const article = localArticles.get(dedupeKey);
      if (article) articles.push({ ...article, sourceIds: Array.from(localArticleSources.get(dedupeKey) ?? []) });
    }
    return articles.map((article) => ({
      ...article,
      json: { ...article.json, subscription_id: id },
    }));
  }

  const members = subscriptionIndexEntries(await command("ZREVRANGE", [subscriptionArticlesKey(id), "0", "-1"]));
  const loaded = await Promise.all(members.map(async (dedupeKey) => {
    const article = await readArticle(dedupeKey);
    return article ? { ...article, sourceIds: await readArticleSources(dedupeKey) } : null;
  }));
  const articles: CachedArticle[] = [];
  for (const article of loaded) if (article) articles.push(article);
  return articles.map((article) => ({
    ...article,
    json: { ...article.json, subscription_id: id },
  }));
}

export async function writeSubscriptionArticles(subscriptionId: string, articles: CachedArticle[]) {
  const id = String(subscriptionId || "").trim();
  if (!id) return;

  const next = new Map(articles.filter((article) => article.dedupeKey).map((article) => [article.dedupeKey, article]));

  if (config.USE_LOCAL_FEED_CACHE) {
    const current = localSubscriptionIndexes.get(id) ?? new Map<string, number>();
    for (const dedupeKey of current.keys()) {
      if (next.has(dedupeKey)) continue;
      current.delete(dedupeKey);
      const sources = localArticleSources.get(dedupeKey);
      sources?.delete(id);
      if (!sources?.size) {
        localArticleSources.delete(dedupeKey);
        localArticles.delete(dedupeKey);
      }
    }
    for (const article of next.values()) {
      const existing = localArticles.get(article.dedupeKey);
      localArticles.set(article.dedupeKey, existing && JSON.stringify(existing.json).length > JSON.stringify(article.json).length ? existing : article);
      current.set(article.dedupeKey, article.publishedAt);
      const sources = localArticleSources.get(article.dedupeKey) ?? new Set<string>();
      sources.add(id);
      localArticleSources.set(article.dedupeKey, sources);
    }
    localSubscriptionIndexes.set(id, current);
    return;
  }

  const current = subscriptionIndexEntries(await command("ZRANGE", [subscriptionArticlesKey(id), "0", "-1"]));
  const stale = current.filter((dedupeKey) => !next.has(dedupeKey));
  if (stale.length) await command("ZREM", [subscriptionArticlesKey(id), ...stale]);

  for (const dedupeKey of stale) {
    await command("SREM", [articleSourcesKey(dedupeKey), id]);
    const remaining = Number(await command("SCARD", [articleSourcesKey(dedupeKey)])) || 0;
    if (!remaining) await command("DEL", [articleDocumentKey(dedupeKey), articleSourcesKey(dedupeKey)]);
  }

  for (const article of next.values()) {
    const existing = await readArticle(article.dedupeKey);
    const selected = existing && JSON.stringify(existing.json).length > JSON.stringify(article.json).length ? existing : article;
    await command("HSET", [
      articleDocumentKey(article.dedupeKey),
      "canonicalUrl", selected.canonicalUrl || "",
      "guid", selected.guid || "",
      "title", selected.title || "",
      "publishedAt", String(selected.publishedAt || 0),
      "json", JSON.stringify(selected.json),
    ]);
    await command("SADD", [articleSourcesKey(article.dedupeKey), id]);
    await command("ZADD", [subscriptionArticlesKey(id), String(article.publishedAt || 0), article.dedupeKey]);
  }
}

export async function deleteSubscriptionArticleIndex(subscriptionId: string) {
  const id = String(subscriptionId || "").trim();
  if (!id) return;
  if (config.USE_LOCAL_FEED_CACHE) {
    const current = localSubscriptionIndexes.get(id) ?? new Map<string, number>();
    for (const dedupeKey of current.keys()) {
      const sources = localArticleSources.get(dedupeKey);
      sources?.delete(id);
      if (!sources?.size) {
        localArticleSources.delete(dedupeKey);
        localArticles.delete(dedupeKey);
      }
    }
    localSubscriptionIndexes.delete(id);
    return;
  }

  const members = subscriptionIndexEntries(await command("ZRANGE", [subscriptionArticlesKey(id), "0", "-1"]));
  await command("DEL", [subscriptionArticlesKey(id)]);
  for (const dedupeKey of members) {
    await command("SREM", [articleSourcesKey(dedupeKey), id]);
    const remaining = Number(await command("SCARD", [articleSourcesKey(dedupeKey)])) || 0;
    if (!remaining) await command("DEL", [articleDocumentKey(dedupeKey), articleSourcesKey(dedupeKey)]);
  }
}

export async function readSubscriptionArticleSources(dedupeKey: string) {
  return readArticleSources(dedupeKey);
}

export async function readMaterializedFeedPage(
  userId: string,
  feedId: string,
  offset: number,
  limit: number,
  consistencyAttempt = 0,
): Promise<{ items: Record<string, unknown>[]; total: number; exists: boolean }> {
  const orderKey = materializedFeedOrderKey(userId, feedId);
  const itemsKey = materializedFeedItemsKey(userId, feedId);

  if (config.USE_LOCAL_FEED_CACHE) {
    const view = localViews.get(orderKey);
    if (!view) return { items: [], total: 0, exists: false };
    const ids = Array.from(view.order.entries()).sort((left, right) => right[1] - left[1]).map(([id]) => id);
    const page = ids.slice(offset, offset + limit).map((id) => parseJson<Record<string, unknown>>(view.items.get(id), {}));
    return { items: page, total: ids.length, exists: true };
  }

  const revisionBefore = toStringValue(await command("HGET", [materializedFeedMetaKey(userId, feedId), "revision"]));
  const total = Number(await command("ZCARD", [orderKey])) || 0;
  const exists = Number(await command("EXISTS", [materializedFeedMetaKey(userId, feedId)])) > 0 || total > 0;
  if (!exists) return { items: [], total: 0, exists: false };

  const ids = subscriptionIndexEntries(await command("ZREVRANGE", [orderKey, String(offset), String(offset + limit - 1)]));
  const values = ids.length ? await command("HMGET", [itemsKey, ...ids]) : [];
  const rawValues = Array.isArray(values) ? values : [];
  const revisionAfter = toStringValue(await command("HGET", [materializedFeedMetaKey(userId, feedId), "revision"]));
  if (revisionBefore && revisionAfter && revisionBefore !== revisionAfter && consistencyAttempt < 2) {
    return readMaterializedFeedPage(userId, feedId, offset, limit, consistencyAttempt + 1);
  }
  return {
    items: rawValues.map((value) => parseJson<Record<string, unknown>>(toStringValue(value), {})).filter((item) => Object.keys(item).length > 0),
    total,
    exists: true,
  };
}

export async function readMaterializedFeedItems(userId: string, feedId: string) {
  const result = await readMaterializedFeedPage(userId, feedId, 0, Number.MAX_SAFE_INTEGER);
  return result.exists ? result.items : null;
}

export async function readFeedCacheMetadata(userId: string, feedId: string): Promise<FeedCacheMetadata | null> {
  const key = materializedFeedMetaKey(userId, feedId);
  if (config.USE_LOCAL_FEED_CACHE) return localMetadata.get(key) ?? null;
  const hash = parseRedisHash(await command("HGETALL", [key]));
  if (!hash) return null;
  return {
    builtAt: hash.builtAt || "",
    revision: hash.revision || "",
    itemCount: Number(hash.itemCount) || 0,
    sourceRevision: hash.sourceRevision || "",
  };
}

export async function writeMaterializedFeed(
  userId: string,
  feedId: string,
  items: MaterializedFeedItem[],
  sourceRevision = "",
) {
  const orderKey = materializedFeedOrderKey(userId, feedId);
  const itemsKey = materializedFeedItemsKey(userId, feedId);
  const revision = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  if (config.USE_LOCAL_FEED_CACHE) {
    const order = new Map<string, number>();
    const itemMap = new Map<string, string>();
    for (const item of items) {
      order.set(item.id, item.score);
      itemMap.set(item.id, JSON.stringify(item.json));
    }
    localViews.set(orderKey, { order, items: itemMap });
    localMetadata.set(materializedFeedMetaKey(userId, feedId), {
      builtAt: new Date().toISOString(), revision, itemCount: items.length, sourceRevision,
    });
    return;
  }

  const tempSuffix = `:tmp:${revision}`;
  const tempOrderKey = `${orderKey}${tempSuffix}`;
  const tempItemsKey = `${itemsKey}${tempSuffix}`;
  for (const item of items) {
    await command("ZADD", [tempOrderKey, String(item.score || 0), item.id]);
    await command("HSET", [tempItemsKey, item.id, JSON.stringify(item.json)]);
  }
  if (!items.length) {
    await command("ZADD", [tempOrderKey, "0", "__dashwise_empty__"]);
    await command("HSET", [tempItemsKey, "__dashwise_empty__", "{}"]);
  }
  await command("EXPIRE", [tempOrderKey, "3600"]);
  await command("EXPIRE", [tempItemsKey, "3600"]);

  await command("EVAL", [
    "redis.call('RENAME', KEYS[1], KEYS[3]); redis.call('RENAME', KEYS[2], KEYS[4]); redis.call('PERSIST', KEYS[3]); redis.call('PERSIST', KEYS[4]); redis.call('ZREM', KEYS[3], '__dashwise_empty__'); redis.call('HDEL', KEYS[4], '__dashwise_empty__'); return 1",
    "4", tempOrderKey, tempItemsKey, orderKey, itemsKey,
  ]);
  await command("HSET", [
    materializedFeedMetaKey(userId, feedId),
    "builtAt", new Date().toISOString(),
    "revision", revision,
    "itemCount", String(items.length),
    "sourceRevision", sourceRevision,
  ]);
}

export async function deleteMaterializedFeed(userId: string, feedId: string) {
  const orderKey = materializedFeedOrderKey(userId, feedId);
  const itemsKey = materializedFeedItemsKey(userId, feedId);
  const metaKey = materializedFeedMetaKey(userId, feedId);

  if (config.USE_LOCAL_FEED_CACHE) {
    localViews.delete(orderKey);
    localMetadata.delete(metaKey);
    return;
  }

  await command("DEL", [orderKey, itemsKey, metaKey]);
}

// Compatibility for the subscription JSON endpoint and older callers. New feed
// construction must use the article/index functions above.
export async function readFeedItemsCache(feedId: string): Promise<unknown[] | null> {
  const articles = await readSubscriptionArticles(feedId);
  if (articles.length) return articles.map((article) => article.json);

  if (config.USE_LOCAL_FEED_CACHE) return null;
  const raw = await command("HGET", [`feedItems:${feedId}`, "json"]);
  const parsed = parseJson<unknown>(toStringValue(raw), null);
  return Array.isArray(parsed) ? parsed : null;
}

export async function writeFeedItemsCache(feedId: string, items: unknown[], feedIds: string[] = [feedId]) {
  if (config.USE_LOCAL_FEED_CACHE) return;
  await command("HSET", [`feedItems:${feedId}`, "json", JSON.stringify(items), "date", new Date().toISOString(), "feedIds", JSON.stringify(feedIds)]);
}

export function clearLocalFeedCache() {
  localArticles.clear();
  localArticleSources.clear();
  localSubscriptionIndexes.clear();
  localViews.clear();
  localMetadata.clear();
}
