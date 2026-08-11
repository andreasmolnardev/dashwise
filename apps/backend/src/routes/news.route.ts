import Parser from "rss-parser";
import { Hono } from "hono";
import type { Context } from "hono";

import { createNewsFeedRecordForUser, deleteNewsSavedArticle, deleteNewsSavedArticleList, getNewsFeed, getNewsFeedRecord, getNewsFeeds, getNewsSavedArticles, getNewsSubscriptions, getNewsSubscriptionJson, renameNewsSavedArticleList, saveNewsArticle, subscribeNewsFeed, unsubscribeNewsFeed, updateNewsFeed, updateNewsFeedRecordForUser, getNewsFeedMetadata, updateNewsSubscription, updateNewsSavedArticleReadState } from "../lib/data/news";
import type { NewsFeedItem, NewsFeedMetadata, NewsFeedRecordCreateInput, NewsFeedRecordUpdateInput, NewsSubscribeInput, NewsUpdateInput } from "@dashwise/types/sdk";

import { readAuthToken, readJsonBody, requireAuth, withJson } from "./shared";
import { createLogger } from "../lib/logger";
import { jobsApi } from "../jobs/index";

const logger = createLogger("API");

const FEED_REQUEST_HEADERS = {
  "User-Agent": "Dashwise RSS Reader (+https://github.com/andrew-d/dashwise)",
  "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
};

async function refreshNewsFeed(userId: string, options: { feedIds: string[] }) {
  const { feedIds } = options;
  if (!feedIds.length) {
    return { status: "success", message: "No feed IDs specified" };
  }

  await jobsApi.runNewsFeedBuilderJob("api", undefined, userId, feedIds);

  return { status: "success" };
}

function readRequestedFeedIds(c: Context) {
  const url = new URL(c.req.url);
  const feedIds = [
    ...url.searchParams.getAll("feedIds"),
    ...url.searchParams.getAll("feedId"),
  ];

  return feedIds
    .flatMap((entry) => String(entry || "").split(","))
    .map((feedId) => feedId.trim())
    .filter(Boolean);
}

async function normalizeNewsFeedUrl(feedUrl: string) {
  const originalFeedUrl = String(feedUrl || "").trim();

  if (!originalFeedUrl) {
    return "";
  }

  if (originalFeedUrl.includes("https://www.youtube.com/@")) {
    const match = originalFeedUrl.match(/@([^/?#]+)/);
    const channelHandle = match?.[1];

    if (channelHandle) {
      try {
        const lookupUrl = `https://www.youtube.com/@${channelHandle}`;
        const response = await fetch(lookupUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0",
          },
        });

        if (response.ok) {
          const html = await response.text();
          const channelId = html.match(
            /<meta[^>]*itemprop=["']identifier["'][^>]*content=["']([^"']+)["'][^>]*>/i
          )?.[1];

          if (channelId) {
            return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
          }
        }
      } catch {
        // Fallback to the original URL below.
      }
    }
  }

  if (originalFeedUrl.includes("reddit.com/r/")) {
    const url = new URL(originalFeedUrl);
    if (!url.pathname.endsWith(".rss") && !url.pathname.endsWith(".rss/")) {
      url.pathname = url.pathname.replace(/\/$/, "") + ".rss";
      return url.toString();
    }
  }

  return originalFeedUrl;
}

async function getFeedMetadata(feedUrl: string): Promise<NewsFeedMetadata> {
  const normalizedFeedUrl = await normalizeNewsFeedUrl(feedUrl);

  if (!normalizedFeedUrl) {
    return { feedUrl: "", title: "", icon: "" };
  }

  try {
    const parser = new Parser<Record<string, unknown>, Record<string, unknown>>({
      headers: FEED_REQUEST_HEADERS,
      customFields: {
        feed: ["image", "icon"],
      },
    });

    const feed = await parser.parseURL(normalizedFeedUrl);
    const title = String(feed?.title || "").trim();
    const image = feed?.image && typeof feed.image === "object" ? (feed.image as Record<string, unknown>) : null;
    const icon = String(image?.url || feed?.icon || "").trim() ||
      `${new URL(feed?.link || normalizedFeedUrl).origin}/favicon.ico`;

    return {
      feedUrl: normalizedFeedUrl,
      title,
      icon,
    };
  } catch (error) {
    logger.error(`Error fetching feed metadata for ${normalizedFeedUrl}`, error);

    try {
      const parsed = new URL(normalizedFeedUrl);
      return {
        feedUrl: normalizedFeedUrl,
        title: "",
        icon: `${parsed.origin}/favicon.ico`,
      };
    } catch {
      return { feedUrl: normalizedFeedUrl, title: "", icon: "" };
    }
  }
}

async function addMissingSubscriptionTitles(userId: string) {
  const subscriptions = await getNewsSubscriptions(userId);

  const missing = subscriptions.subscriptions.filter(
    (sub) => !sub.title || sub.title === sub.feedUrl
  );

  let updatedCount = 0;
  for (const sub of missing) {
    if (!sub.id || !sub.feedUrl) continue;
    try {
      const metadata = await getNewsFeedMetadata(sub.feedUrl);
      const titleToUse = metadata.title || new URL(sub.feedUrl).hostname;
      if (titleToUse) {
        await updateNewsSubscription(sub.id, { title: titleToUse });
        updatedCount++;
      }
    } catch (err) {
      logger.error(`Failed to update subscription title for ${sub.feedUrl}`, err);
    }
  }

  return { success: true, updatedCount };
}

const newsRoute = new Hono();

newsRoute
  .get("/api/v1/news", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    const [subscriptions, feeds] = await Promise.all([
      getNewsSubscriptions(userId),
      getNewsFeeds(userId),
    ]);

    return {
      ...subscriptions,
      ...feeds,
    };
  }))
  .get("/api/v1/news/subscriptions", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getNewsSubscriptions(userId);
  }))
  .get("/api/v1/news/subscriptions/:id/json", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getNewsSubscriptionJson(userId, String(c.req.param("id") ?? ""));
  }))
  .get("/api/v1/news/feeds", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getNewsFeeds(userId);
  }))
  .get("/api/v1/news/saved-articles", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getNewsSavedArticles(userId, c.req.query("list"));
  }))
  .post("/api/v1/news/saved-articles", withJson(async (c) => {
    const body = await readJsonBody<{ article?: NewsFeedItem; list?: string }>(c);
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return saveNewsArticle(userId, body?.article ?? ({} as NewsFeedItem), body?.list);
  }))
  .delete("/api/v1/news/saved-articles", withJson(async (c) => {
    const body = await readJsonBody<{ link?: string }>(c);
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return deleteNewsSavedArticle(userId, String(body?.link ?? ""));
  }))
  .patch("/api/v1/news/saved-articles/read", withJson(async (c) => {
    const body = await readJsonBody<{ link?: string; isRead?: boolean }>(c);
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return updateNewsSavedArticleReadState(userId, String(body?.link ?? ""), body?.isRead ?? true);
  }))
  .delete("/api/v1/news/saved-article-lists/:id", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return deleteNewsSavedArticleList(userId, String(c.req.param("id") ?? ""));
  }))
  .patch("/api/v1/news/saved-article-lists/:id", withJson(async (c) => {
    const body = await readJsonBody<{ name?: string }>(c);
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return renameNewsSavedArticleList(userId, String(c.req.param("id") ?? ""), String(body?.name ?? ""));
  }))
  .get("/api/v1/news/feeds/:id", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    const limit = Number(c.req.query("limit") ?? "");
    const offset = Number(c.req.query("offset") ?? "");
    return getNewsFeed(userId, c.req.param("id"), {
      limit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : undefined,
      offset: Number.isFinite(offset) && offset >= 0 ? Math.floor(offset) : undefined,
    });
  }))
  .get("/api/v1/news/feed", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    const limit = Number(c.req.query("limit") ?? "");
    const offset = Number(c.req.query("offset") ?? "");
    return getNewsFeed(userId, c.req.query("feedId") ?? "all", {
      limit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : undefined,
      offset: Number.isFinite(offset) && offset >= 0 ? Math.floor(offset) : undefined,
    });
  }))
  .get("/api/v1/news/feed-records/:id", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getNewsFeedRecord(userId, String(c.req.param("id") ?? ""));
  }))
  .post("/api/v1/news/feed-records", withJson(async (c) => {
    const body = await readJsonBody<NewsFeedRecordCreateInput>(c);
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return createNewsFeedRecordForUser(userId, body ?? { title: "" });
  }))
  .get("/api/v1/news/feed-metadata", withJson(async (c) => {
    await requireAuth({ token: readAuthToken(c) });

    const feedUrl = String(c.req.query("url") ?? "").trim();
    if (!feedUrl) {
      return { feedUrl: "", title: "", icon: "" };
    }

    return getFeedMetadata(feedUrl);
  }))
  .get("/api/v1/news/feed-refresh", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return refreshNewsFeed(userId, { feedIds: readRequestedFeedIds(c) });
  }))
  .post("/api/v1/news/feed-refresh", withJson(async (c) => {
    const body = await readJsonBody<{ feedIds?: string[]; feedId?: string }>(c);
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return refreshNewsFeed(userId, {
      feedIds: Array.isArray(body?.feedIds)
        ? body.feedIds
        : body?.feedId
          ? [String(body.feedId)]
          : readRequestedFeedIds(c),
    });
  }))
  .post("/api/v1/news/feed-subscribe", withJson(async (c) => {
    const body = await readJsonBody<{ sub?: NewsSubscribeInput }>(c);
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    const sub: NewsSubscribeInput = body?.sub ?? { feedUrl: "" };

    const result = await subscribeNewsFeed(userId, {
      feedUrl: await normalizeNewsFeedUrl(sub.feedUrl),
      name: sub.name,
      icon: sub.icon,
      feedIds: Array.isArray(sub.feedIds) ? sub.feedIds : [],
      newFeedTitles: Array.isArray(sub.newFeedTitles) ? sub.newFeedTitles : [],
      linkReplaceRule: sub.linkReplaceRule,
      fallbackThumbnailUrl: sub.fallbackThumbnailUrl,
      thumbnailOverwriteUrl: sub.thumbnailOverwriteUrl,
    });

    return result;
  }))
  .post("/api/v1/news/feed-unsubscribe", withJson(async (c) => {
    const body = await readJsonBody<{ feedUrl?: string }>(c);
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return unsubscribeNewsFeed(userId, String(body?.feedUrl ?? ""));
  }))
  .post("/api/v1/news/feed-update", withJson(async (c) => {
    const body = await readJsonBody<{ payload?: NewsUpdateInput }>(c);
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    const payload: NewsUpdateInput = body?.payload ?? { feedUrl: "" };
    return updateNewsFeed(userId, payload);
  }))
  .post("/api/v1/news/feed-records/:id", withJson(async (c) => {
    const body = await readJsonBody<Partial<NewsFeedRecordUpdateInput>>(c);
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    const feedId = String(c.req.param("id") ?? body?.feedId ?? "").trim();
    return updateNewsFeedRecordForUser(userId, feedId, body ?? {});
  }))
  .post("/api/v1/news/fix-missing-titles", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return addMissingSubscriptionTitles(userId);
  }));

export default newsRoute;
