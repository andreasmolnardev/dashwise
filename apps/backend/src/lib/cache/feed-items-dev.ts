import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

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

type Row = Record<string, unknown>;

const database = (Bun.env.ENVIRONMENT === "dev"
  ? (() => {
      const databasePath = Bun.env.DASHWISE_DEV_NEWS_DB_PATH || ".data/news-dev.sqlite";
      mkdirSync(dirname(databasePath), { recursive: true });
      return new Database(databasePath);
    })()
  : null) as Database;

if (database) database.exec(`
  CREATE TABLE IF NOT EXISTS articles (
    dedupe_key TEXT PRIMARY KEY,
    canonical_url TEXT,
    guid TEXT,
    title TEXT NOT NULL,
    published_at INTEGER NOT NULL,
    json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS article_sources (
    dedupe_key TEXT NOT NULL,
    subscription_id TEXT NOT NULL,
    PRIMARY KEY (dedupe_key, subscription_id)
  );
  CREATE TABLE IF NOT EXISTS subscription_articles (
    subscription_id TEXT NOT NULL,
    dedupe_key TEXT NOT NULL,
    published_at INTEGER NOT NULL,
    PRIMARY KEY (subscription_id, dedupe_key)
  );
  CREATE TABLE IF NOT EXISTS subscription_fetches (
    subscription_id TEXT PRIMARY KEY,
    fetched_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS materialized_items (
    user_id TEXT NOT NULL,
    feed_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    score REAL NOT NULL,
    json TEXT NOT NULL,
    PRIMARY KEY (user_id, feed_id, item_id)
  );
  CREATE TABLE IF NOT EXISTS materialized_metadata (
    user_id TEXT NOT NULL,
    feed_id TEXT NOT NULL,
    built_at TEXT NOT NULL,
    revision TEXT NOT NULL,
    item_count INTEGER NOT NULL,
    source_revision TEXT NOT NULL,
    PRIMARY KEY (user_id, feed_id)
  );
`);

const parseJson = <T>(value: unknown, fallback: T): T => {
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
};



export function hasSubscriptionArticles(subscriptionId: string) {
  return Boolean(database.query("SELECT 1 FROM subscription_fetches WHERE subscription_id = ? LIMIT 1").get(subscriptionId));
}

export function readArticle(dedupeKey: string): CachedArticle | null {
  const row = database.query("SELECT dedupe_key, canonical_url, guid, title, published_at, json FROM articles WHERE dedupe_key = ?").get(dedupeKey) as Row | null;
  if (!row) return null;
  return {
    dedupeKey: String(row.dedupe_key),
    canonicalUrl: row.canonical_url ? String(row.canonical_url) : undefined,
    guid: row.guid ? String(row.guid) : undefined,
    title: String(row.title || ""),
    publishedAt: Number(row.published_at) || 0,
    json: parseJson<Record<string, unknown>>(row.json, {}),
  };
}

export function readArticleSources(dedupeKey: string) {
  return (database.query("SELECT subscription_id FROM article_sources WHERE dedupe_key = ?").all(dedupeKey) as Row[])
    .map((row) => String(row.subscription_id));
}

export function readSubscriptionArticles(subscriptionId: string): CachedArticle[] {
  const rows = database.query(`
    SELECT a.dedupe_key, a.canonical_url, a.guid, a.title, a.published_at, a.json
    FROM subscription_articles sa
    JOIN articles a ON a.dedupe_key = sa.dedupe_key
    WHERE sa.subscription_id = ?
    ORDER BY sa.published_at DESC
  `).all(subscriptionId) as Row[];

  return rows.map((row) => ({
    dedupeKey: String(row.dedupe_key),
    canonicalUrl: row.canonical_url ? String(row.canonical_url) : undefined,
    guid: row.guid ? String(row.guid) : undefined,
    title: String(row.title || ""),
    publishedAt: Number(row.published_at) || 0,
    json: { ...parseJson<Record<string, unknown>>(row.json, {}), subscription_id: subscriptionId },
    sourceIds: readArticleSources(String(row.dedupe_key)),
  }));
}

export function writeSubscriptionArticles(subscriptionId: string, articles: CachedArticle[]) {
  const transaction = database.transaction(() => {
    const current = (database.query("SELECT dedupe_key FROM subscription_articles WHERE subscription_id = ?").all(subscriptionId) as Row[])
      .map((row) => String(row.dedupe_key));
    const next = new Map(articles.filter((article) => article.dedupeKey).map((article) => [article.dedupeKey, article]));

    for (const dedupeKey of current) {
      if (next.has(dedupeKey)) continue;
      database.query("DELETE FROM subscription_articles WHERE subscription_id = ? AND dedupe_key = ?").run(subscriptionId, dedupeKey);
      database.query("DELETE FROM article_sources WHERE subscription_id = ? AND dedupe_key = ?").run(subscriptionId, dedupeKey);
      database.query("DELETE FROM articles WHERE dedupe_key = ? AND NOT EXISTS (SELECT 1 FROM article_sources WHERE dedupe_key = ?)").run(dedupeKey, dedupeKey);
    }

    for (const article of next.values()) {
      const existing = readArticle(article.dedupeKey);
      const selected = existing && JSON.stringify(existing.json).length > JSON.stringify(article.json).length ? existing : article;
      database.query(`
        INSERT INTO articles (dedupe_key, canonical_url, guid, title, published_at, json)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(dedupe_key) DO UPDATE SET
          canonical_url = excluded.canonical_url,
          guid = excluded.guid,
          title = excluded.title,
          published_at = excluded.published_at,
          json = excluded.json
      `).run(
        article.dedupeKey,
        selected.canonicalUrl || "",
        selected.guid || "",
        selected.title || "",
        selected.publishedAt || 0,
        JSON.stringify(selected.json),
      );
      database.query("INSERT OR REPLACE INTO subscription_articles (subscription_id, dedupe_key, published_at) VALUES (?, ?, ?)")
        .run(subscriptionId, article.dedupeKey, article.publishedAt || 0);
      database.query("INSERT OR IGNORE INTO article_sources (dedupe_key, subscription_id) VALUES (?, ?)")
        .run(article.dedupeKey, subscriptionId);
    }
    database.query("INSERT OR REPLACE INTO subscription_fetches (subscription_id, fetched_at) VALUES (?, ?)")
      .run(subscriptionId, new Date().toISOString());
  });
  transaction();
}

export function deleteSubscriptionArticleIndex(subscriptionId: string) {
  const transaction = database.transaction(() => {
    const rows = database.query("SELECT dedupe_key FROM subscription_articles WHERE subscription_id = ?").all(subscriptionId) as Row[];
    database.query("DELETE FROM subscription_articles WHERE subscription_id = ?").run(subscriptionId);
    database.query("DELETE FROM article_sources WHERE subscription_id = ?").run(subscriptionId);
    for (const row of rows) {
      database.query("DELETE FROM articles WHERE dedupe_key = ? AND NOT EXISTS (SELECT 1 FROM article_sources WHERE dedupe_key = ?)")
        .run(String(row.dedupe_key), String(row.dedupe_key));
    }
    database.query("DELETE FROM subscription_fetches WHERE subscription_id = ?").run(subscriptionId);
  });
  transaction();
}

export function readMaterializedFeedPage(userId: string, feedId: string, offset: number, limit: number) {
  const rows = database.query(`
    SELECT item_id, score, json FROM materialized_items
    WHERE user_id = ? AND feed_id = ?
    ORDER BY score DESC
    LIMIT ? OFFSET ?
  `).all(userId, feedId, limit, offset) as Row[];
  const countRow = database.query("SELECT COUNT(*) AS count FROM materialized_items WHERE user_id = ? AND feed_id = ?").get(userId, feedId) as Row | null;
  const total = Number(countRow?.count || 0);
  const exists = Boolean(database.query("SELECT 1 FROM materialized_metadata WHERE user_id = ? AND feed_id = ? LIMIT 1").get(userId, feedId)) || total > 0;
  return {
    items: rows.map((row) => parseJson<Record<string, unknown>>(row.json, {})),
    total,
    exists,
  };
}

export function readFeedCacheMetadata(userId: string, feedId: string): FeedCacheMetadata | null {
  const row = database.query("SELECT built_at, revision, item_count, source_revision FROM materialized_metadata WHERE user_id = ? AND feed_id = ?")
    .get(userId, feedId) as Row | null;
  return row ? {
    builtAt: String(row.built_at || ""),
    revision: String(row.revision || ""),
    itemCount: Number(row.item_count) || 0,
    sourceRevision: String(row.source_revision || ""),
  } : null;
}

export function writeMaterializedFeed(userId: string, feedId: string, items: MaterializedFeedItem[], sourceRevision = "") {
  const revision = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const transaction = database.transaction(() => {
    database.query("DELETE FROM materialized_items WHERE user_id = ? AND feed_id = ?").run(userId, feedId);
    for (const item of items) {
      database.query("INSERT INTO materialized_items (user_id, feed_id, item_id, score, json) VALUES (?, ?, ?, ?, ?)")
        .run(userId, feedId, item.id, item.score || 0, JSON.stringify(item.json));
    }
    database.query(`
      INSERT INTO materialized_metadata (user_id, feed_id, built_at, revision, item_count, source_revision)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, feed_id) DO UPDATE SET
        built_at = excluded.built_at,
        revision = excluded.revision,
        item_count = excluded.item_count,
        source_revision = excluded.source_revision
    `).run(userId, feedId, new Date().toISOString(), revision, items.length, sourceRevision);
  });
  transaction();
}

export function deleteMaterializedFeed(userId: string, feedId: string) {
  database.query("DELETE FROM materialized_items WHERE user_id = ? AND feed_id = ?").run(userId, feedId);
  database.query("DELETE FROM materialized_metadata WHERE user_id = ? AND feed_id = ?").run(userId, feedId);
}

export function readFeedItemsCache(feedId: string): unknown[] | null {
  const articles = readSubscriptionArticles(feedId);
  return articles.length ? articles.map((article) => article.json) : null;
}

export function clearLocalFeedCache() {
  database.exec(`
    DELETE FROM articles;
    DELETE FROM article_sources;
    DELETE FROM subscription_articles;
    DELETE FROM subscription_fetches;
    DELETE FROM materialized_items;
    DELETE FROM materialized_metadata;
  `);
}
