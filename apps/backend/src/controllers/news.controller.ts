import Parser from "rss-parser";
import type { Hono } from "hono";

import { getNewsFeed, getNewsFeeds, getNewsSubscriptions, refreshNewsFeed, subscribeNewsFeed, unsubscribeNewsFeed, updateNewsFeed } from "@dashwise/sdk/data/news";

import { readAuthToken, readJsonBody, requireAuth, withJson } from "./shared";

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

async function getFeedMetadata(feedUrl: string) {
  const normalizedFeedUrl = await normalizeNewsFeedUrl(feedUrl);

  if (!normalizedFeedUrl) {
    return { feedUrl: "", title: "", icon: "" };
  }

  try {
    const parser = new Parser<any, any>({
      customFields: {
        feed: ["image", "icon"],
      },
    });

    const feed = await parser.parseURL(normalizedFeedUrl);
    const title = String(feed?.title || "").trim();
    const icon = String(feed?.image?.url || feed?.icon || "").trim() ||
      `${new URL(feed?.link || normalizedFeedUrl).origin}/favicon.ico`;

    return {
      feedUrl: normalizedFeedUrl,
      title,
      icon,
    };
  } catch (error) {
    console.error(`Error fetching feed metadata: ${normalizedFeedUrl}`, error);

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
    return refreshNewsFeed(userId);
  }));
  app.post("/api/v1/news/feed-refresh", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return refreshNewsFeed(userId);
  }));
  app.post("/api/v1/news/feed-subscribe", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    const sub = body?.sub ?? {};

    return subscribeNewsFeed(userId, {
      feedUrl: String(sub.feedUrl ?? ""),
      name: sub.name,
      icon: sub.icon,
      feedIds: Array.isArray(sub.feedIds) ? sub.feedIds : [],
      newFeedTitles: Array.isArray(sub.newFeedTitles) ? sub.newFeedTitles : [],
    });
  }));
  app.post("/api/v1/news/feed-unsubscribe", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return unsubscribeNewsFeed(userId, String(body?.feedUrl ?? ""));
  }));
  app.post("/api/v1/news/feed-update", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return updateNewsFeed(userId, body?.payload ?? {});
  }));
}