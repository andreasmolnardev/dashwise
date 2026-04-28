import { Hono } from "hono";

import { createForwarder, deleteForwarder, getForwarders, updateForwarder } from "@dashwise/sdk/data/notifications/forwarders";
import { createNotificationTopic, getNotificationTopics, getNotifications, markNotificationsAsRead } from "@dashwise/sdk/data/notifications/items";
import { createTopicToken, deleteTopicToken, listTopicTokens } from "@dashwise/sdk/data/notifications/topicTokens";

import { readAuthToken, readJsonBody, readBool, requireAuth, withJson } from "./shared";

const notificationsRoute = new Hono();
  notificationsRoute.get("/api/v1/notifications", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getNotifications(userId, readBool(c.req.query("unread") ?? undefined), readBool(c.req.query("count") ?? undefined));
  }));
  notificationsRoute.post("/api/v1/notifications", withJson(async () => ({ ok: true })));
  notificationsRoute.get("/api/v1/notifications/topics", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getNotificationTopics(userId);
  }));
  notificationsRoute.post("/api/v1/notifications/topics", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return createNotificationTopic(userId, String(body?.title ?? ""));
  }));
  notificationsRoute.post("/api/v1/notifications/markAsRead", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return markNotificationsAsRead(userId, Array.isArray(body?.ids) ? body.ids : []);
  }));
  notificationsRoute.post("/api/v1/notifications/:topic", withJson(async () => ({ ok: true })));
  notificationsRoute.get("/api/v1/notifications/topicTokens", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return listTopicTokens(userId);
  }));
  notificationsRoute.post("/api/v1/notifications/topicTokens", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return createTopicToken(userId, body?.body ?? {});
  }));
  notificationsRoute.delete("/api/v1/notifications/topicTokens", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return deleteTopicToken(userId, String(body?.tokenId ?? ""));
  }));
  notificationsRoute.get("/api/v1/notifications/forwarders", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getForwarders(userId);
  }));
  notificationsRoute.post("/api/v1/notifications/forwarders", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return createForwarder(userId, body?.body ?? {});
  }));
  notificationsRoute.put("/api/v1/notifications/forwarders", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return updateForwarder(userId, body?.body ?? {});
  }));
  notificationsRoute.delete("/api/v1/notifications/forwarders", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return deleteForwarder(userId, String(body?.forwarderId ?? ""));
  }));

export default notificationsRoute;
