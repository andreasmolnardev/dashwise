import type { Hono } from "hono";

import { getNewsFeed, getNewsSubscriptions, refreshNewsFeed, subscribeNewsFeed, unsubscribeNewsFeed, updateNewsFeed } from "@dashwise/sdk/data/news";

import { readAuthToken, readJsonBody, requireAuth, withJson } from "./shared";

export function registerNewsControllers(app: Hono) {
  app.get("/api/v1/news", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getNewsSubscriptions(userId);
  }));
  app.get("/api/v1/news/feed", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getNewsFeed(userId, c.req.query("feedId") ?? null);
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
    return subscribeNewsFeed(userId, body?.sub ?? {});
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