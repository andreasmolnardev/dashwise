import { Hono } from "hono";
import type { Context } from "hono";

import { ApiActionError } from "../lib/data/auth";
import { createForwarder, deleteForwarder, getForwarders, testForwarder, testForwarderTarget, updateForwarder } from "../lib/data/notifications/forwarders";
import { createNotificationTopic, deleteNotificationTopic, getNotificationTopics, getNotifications, markNotificationsAsRead, sendTestNotification } from "../lib/data/notifications/items";
import { createNotificationByTopicId, createNotificationWithTopicToken } from "../lib/data/notifications/publish";
import { createTopicToken, deleteTopicToken, listTopicTokens, updateTopicToken } from "../lib/data/notifications/topicTokens";
import { getServerPB, getSuperuserPB } from "../lib/pb/pocketbase";

import { readAuthToken, readJsonBody, readBool, requireAuth, withJson } from "./shared";

const notificationsRoute = new Hono();

function readBasicAuthCredentials(authorizationHeader: string | undefined) {
  if (!authorizationHeader?.toLowerCase().startsWith("basic ")) {
    return null;
  }

  const encoded = authorizationHeader.slice(6).trim();
  if (!encoded) {
    return null;
  }

  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf-8");
    const [email, password] = decoded.split(":", 2);
    if (!email || !password) {
      return null;
    }

    return { email, password };
  } catch {
    return null;
  }
}

async function resolveUserIdFromRequest(c: Context) {
  const authToken = readAuthToken(c);
  if (authToken) {
    return (await requireAuth({ token: authToken })).userId;
  }

  const basicAuth = readBasicAuthCredentials(c.req.header("authorization") ?? c.req.header("Authorization"));
  if (!basicAuth) {
    return null;
  }

  const pb = getServerPB();
  try {
    await pb.collection("users").authWithPassword(basicAuth.email, basicAuth.password);
  } catch {
    throw new ApiActionError("Unauthorized", 401, { error: "Unauthorized" });
  }

  const userId = pb.authStore.model?.id;
  if (!userId) {
    throw new ApiActionError("Unauthorized", 401, { error: "Unauthorized" });
  }

  return userId;
}

async function verifyTopicOwnership(topicId: string, userId: string) {
  const pb = await getSuperuserPB();
  let topic;

  try {
    topic = await pb.collection("notificationTopics").getOne(topicId);
  } catch {
    throw new ApiActionError("Topic not found", 404, { error: "Topic not found" });
  }

  if (!topic || topic.userId !== userId) {
    throw new ApiActionError("Topic not found", 404, { error: "Topic not found" });
  }

  return topic;
}

notificationsRoute
  .get("/api/v1/notifications", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getNotifications(userId, readBool(c.req.query("unread") ?? undefined), readBool(c.req.query("count") ?? undefined));
  }))
  .post("/api/v1/notifications", withJson(async () => ({ ok: true })))
  .get("/api/v1/notifications/topics", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getNotificationTopics(userId);
  }))
  .post("/api/v1/notifications/topics", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return createNotificationTopic(userId, String(body?.title ?? ""));
  }))
  .delete("/api/v1/notifications/topics", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return deleteNotificationTopic(userId, String(body?.topicId ?? ""));
  }))
  .post("/api/v1/notifications/markAsRead", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return markNotificationsAsRead(userId, Array.isArray(body?.ids) ? body.ids : []);
  }))
  .post("/api/v1/notifications/test", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return sendTestNotification(userId, String(body?.topicId ?? ""));
  }))
  .get("/api/v1/notifications/topicTokens", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return listTopicTokens(userId);
  }))
  .post("/api/v1/notifications/topicTokens", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return createTopicToken(userId, body);
  }))
  .delete("/api/v1/notifications/topicTokens", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return deleteTopicToken(userId, String(body?.tokenId ?? ""));
  }))
  .put("/api/v1/notifications/topicTokens", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return updateTopicToken(userId, body ?? {});
  }))
  .get("/api/v1/notifications/forwarders", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getForwarders(userId);
  }))
  .post("/api/v1/notifications/forwarders", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return createForwarder(userId, body ?? {});
  }))
  .put("/api/v1/notifications/forwarders", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return updateForwarder(userId, body ?? {});
  }))
  .delete("/api/v1/notifications/forwarders", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return deleteForwarder(userId, String(body?.forwarderId ?? ""));
  }))
  .post("/api/v1/notifications/forwarders/test", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return body?.forwarderId
      ? testForwarder(userId, String(body.forwarderId))
      : testForwarderTarget(String(body?.target ?? ""));
  }))
  .post("/api/v1/notifications/:topic", withJson(async (c) => {
    const topic = String(c.req.param("topic") ?? "").trim();
    const body = await readJsonBody<any>(c);
    const content = body?.content ?? body;
    const source = String(body?.source ?? "api");

    const topicTokenResult = await createNotificationWithTopicToken(topic, content);
    if (topicTokenResult) {
      return { ok: true, ...topicTokenResult };
    }

    const userId = await resolveUserIdFromRequest(c);
    if (!userId) {
      throw new ApiActionError("Unauthorized", 401, { error: "Unauthorized" });
    }

    await verifyTopicOwnership(topic, userId);
    return { ok: true, ...(await createNotificationByTopicId(topic, content, source)) };
  }));

export default notificationsRoute;
