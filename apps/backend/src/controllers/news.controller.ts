import Parser from "rss-parser";
import type { Context, Hono } from "hono";

import { getNewsFeed, getNewsFeedRecord, getNewsFeeds, getNewsSubscriptions, refreshNewsFeed, subscribeNewsFeed, unsubscribeNewsFeed, updateNewsFeed, updateNewsFeedRecordForUser } from "@dashwise/sdk/data/news";
import type { NewsFeedMetadata, NewsFeedRecordUpdateInput, NewsSubscribeInput, NewsUpdateInput } from "@dashwise/sdk/data/news";

import { readAuthToken, readJsonBody, requireAuth, withJson } from "./shared";
import { createLogger } from "../lib/logger";

const logger = createLogger("API");

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
          const channelMatch = html.match(/"channelId":"([^"]+)"/);
          if (channelMatch?.[1]) {
            return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelMatch[1]}`;
          }
        }
      } catch {
        // Fallback to the original URL below.
      }
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

export function registerNewsControllers(app: Hono) {
  app.get("/api/v1/news", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    const [subscriptions, feeds] = await Promise.all([
      getNewsSubscriptions(userId),
      getNewsFeeds(userId),
    ]);

    return {
      ...subscriptions,
      ...feeds,
    };
  }));
  app.get("/api/v1/news/subscriptions", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getNewsSubscriptions(userId);
  }));
  app.get("/api/v1/news/feeds", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getNewsFeeds(userId);
  }));
  app.get("/api/v1/news/feeds/:id", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getNewsFeed(userId, c.req.param("id"));
  }));
  app.get("/api/v1/news/feed", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getNewsFeed(userId, c.req.query("feedId") ?? "all");
  }));
  app.get("/api/v1/news/feed-records/:id", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getNewsFeedRecord(userId, String(c.req.param("id") ?? ""));
  }));
  app.get("/api/v1/news/feed-metadata", withJson(async (c) => {
    await requireAuth({ token: readAuthToken(c) });

    const feedUrl = String(c.req.query("url") ?? "").trim();
    if (!feedUrl) {
      return { feedUrl: "", title: "", icon: "" };
    }

    return getFeedMetadata(feedUrl);
  }));
  app.get("/api/v1/news/feed-refresh", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return refreshNewsFeed(userId, { feedIds: readRequestedFeedIds(c) });
  }));
  app.post("/api/v1/news/feed-refresh", withJson(async (c) => {
    const body = await readJsonBody<{ auth?: { token?: string | null }; feedIds?: string[]; feedId?: string }>(c);
    const { userId } = await requireAuth(body?.auth ?? {});
    return refreshNewsFeed(userId, {
      feedIds: Array.isArray(body?.feedIds)
        ? body.feedIds
        : body?.feedId
          ? [String(body.feedId)]
          : readRequestedFeedIds(c),
    });
  }));
  app.post("/api/v1/news/feed-subscribe", withJson(async (c) => {
    const body = await readJsonBody<{ auth?: { token?: string | null }; sub?: NewsSubscribeInput }>(c);
    const { userId } = await requireAuth(body?.auth ?? {});
    const sub: NewsSubscribeInput = body?.sub ?? { feedUrl: "" };

    return subscribeNewsFeed(userId, {
      feedUrl: String(sub.feedUrl ?? ""),
      name: sub.name,
      icon: sub.icon,
      feedIds: Array.isArray(sub.feedIds) ? sub.feedIds : [],
      newFeedTitles: Array.isArray(sub.newFeedTitles) ? sub.newFeedTitles : [],
    });
  }));
  app.post("/api/v1/news/feed-unsubscribe", withJson(async (c) => {
    const body = await readJsonBody<{ auth?: { token?: string | null }; feedUrl?: string }>(c);
    const { userId } = await requireAuth(body?.auth ?? {});
    return unsubscribeNewsFeed(userId, String(body?.feedUrl ?? ""));
  }));
  app.post("/api/v1/news/feed-update", withJson(async (c) => {
    const body = await readJsonBody<{ auth?: { token?: string | null }; payload?: NewsUpdateInput }>(c);
    const { userId } = await requireAuth(body?.auth ?? {});
    const payload: NewsUpdateInput = body?.payload ?? { feedUrl: "" };
    return updateNewsFeed(userId, payload);
  }));
  app.post("/api/v1/news/feed-records/:id", withJson(async (c) => {
    const body = await readJsonBody<{ auth?: { token?: string | null }; payload?: Partial<NewsFeedRecordUpdateInput> }>(c);
    const { userId } = await requireAuth(body?.auth ?? {});
    const feedId = String(c.req.param("id") ?? body?.payload?.feedId ?? "").trim();
    const payload = body?.payload ?? {};
    return updateNewsFeedRecordForUser(userId, feedId, payload);
  }));
}
