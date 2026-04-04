import type { Hono } from "hono";

import { createForwarder, deleteForwarder, getForwarders, updateForwarder } from "@dashwise/sdk/data/notifications/forwarders";
import { createNotificationTopic, getNotificationTopics, getNotifications, markNotificationsAsRead } from "@dashwise/sdk/data/notifications/items";
import { createTopicToken, deleteTopicToken, listTopicTokens } from "@dashwise/sdk/data/notifications/topicTokens";

import { readAuthToken, readJsonBody, readBool, requireAuth, withJson } from "./shared";

export function registerNotificationsControllers(app: Hono) {
  app.get("/api/v1/notifications", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getNotifications(userId, readBool(c.req.query("unread") ?? undefined), readBool(c.req.query("count") ?? undefined));
  }));
  app.post("/api/v1/notifications", withJson(async () => ({ ok: true })));
  app.get("/api/v1/notifications/topics", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getNotificationTopics(userId);
  }));
  app.post("/api/v1/notifications/topics", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return createNotificationTopic(userId, String(body?.title ?? ""));
  }));
  app.post("/api/v1/notifications/markAsRead", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return markNotificationsAsRead(userId, Array.isArray(body?.ids) ? body.ids : []);
  }));
  app.post("/api/v1/notifications/:topic", withJson(async () => ({ ok: true })));
  app.get("/api/v1/notifications/topicTokens", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return listTopicTokens(userId);
  }));
  app.post("/api/v1/notifications/topicTokens", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return createTopicToken(userId, body?.body ?? {});
  }));
  app.delete("/api/v1/notifications/topicTokens", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return deleteTopicToken(userId, String(body?.tokenId ?? ""));
  }));
  app.get("/api/v1/notifications/forwarders", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getForwarders(userId);
  }));
  app.post("/api/v1/notifications/forwarders", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return createForwarder(userId, body?.body ?? {});
  }));
  app.put("/api/v1/notifications/forwarders", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return updateForwarder(userId, body?.body ?? {});
  }));
  app.delete("/api/v1/notifications/forwarders", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return deleteForwarder(userId, String(body?.forwarderId ?? ""));
  }));
}