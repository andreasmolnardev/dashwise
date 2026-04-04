import type { Hono } from "hono";

import { createIntegration, getIntegration, getIntegrationWithWidget, getWidgetProperties, listIntegrations, testIntegrationEndpoint } from "@dashwise/sdk/data/integrations";
import { appendConfigArrayItem, deleteUnusedLinkgroups, getUserConfig, migrateLegacyPageConfig, moveConfigArrayItems, patchConfigPath, replaceUserConfig } from "@dashwise/sdk/data/config";
import { createHomeLinkGroup, createHomeLinkItem, deleteLinkItem, getHomeLinkGroups, getHomeLinks, getLinksCollections, getLinksFolders, getLinksItems, getLinksTags, updateHomeLinkItem } from "@dashwise/sdk/data/links";
import { getUserGlanceable, getUserWidgets } from "@dashwise/sdk/data/widgets";
import { getNewsFeed, getNewsSubscriptions, refreshNewsFeed, subscribeNewsFeed, unsubscribeNewsFeed, updateNewsFeed } from "@dashwise/sdk/data/news";
import { createForwarder, deleteForwarder, getForwarders, updateForwarder } from "@dashwise/sdk/data/notifications/forwarders";
import { createNotificationTopic, getNotificationTopics, getNotifications, markNotificationsAsRead } from "@dashwise/sdk/data/notifications/items";
import { createTopicToken, deleteTopicToken, listTopicTokens } from "@dashwise/sdk/data/notifications/topicTokens";
import { getPageConfigJSON, getUserPages, updatePageConfig } from "@dashwise/sdk/data/pageConfig";
import { getMonitoringStatus, runMonitoringStatus } from "@dashwise/sdk/data/monitoring";
import { uploadWallpaper } from "@dashwise/sdk/data/wallpapers";

import { loadSignupDefaults, readAuthToken, readBool, readJsonBody, requireAuth, normalizePageName, withJson } from "./shared";

export function registerDataControllers(app: Hono) {
  app.get("/api/v1/config", withJson(async (c) => {
    const auth = { token: readAuthToken(c) };
    const { userId } = await requireAuth(auth);
    return getUserConfig(userId, c.req.query("pageName") ?? undefined);
  }));
  app.post("/api/v1/config", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return appendConfigArrayItem(userId, String(body?.path ?? ""), body?.newItem, body?.pageName);
  }));
  app.patch("/api/v1/config", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return patchConfigPath(userId, String(body?.path ?? ""), body?.updatedItem, body?.pageName);
  }));
  app.put("/api/v1/config", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return replaceUserConfig(userId, body?.nextConfig ?? {}, body?.pageName);
  }));
  app.post("/api/v1/config/delete-unused-linkgroups", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return deleteUnusedLinkgroups(userId);
  }));
  app.post("/api/v1/config/move-arrayitems", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return moveConfigArrayItems(userId, String(body?.path ?? ""), Number(body?.src ?? 0), Number(body?.dst ?? 0));
  }));
  app.post("/api/v1/config/migrate-legacy-page-config", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return migrateLegacyPageConfig(userId);
  }));

  app.get("/api/v1/pageConfig", withJson(async (c) => {
    const auth = { token: readAuthToken(c) };
    const { userId } = await requireAuth(auth);
    return getPageConfigJSON(userId, normalizePageName(c.req.query("pageName") ?? undefined));
  }));
  app.get("/api/v1/pageConfig/user-pages", withJson(async (c) => {
    const auth = { token: readAuthToken(c) };
    const { userId } = await requireAuth(auth);
    return getUserPages(userId);
  }));
  app.put("/api/v1/pageConfig", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return updatePageConfig(userId, normalizePageName(body?.pageName), body?.config ?? {});
  }));
  app.post("/api/v1/pageConfig/home", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    const existingHomeConfig = await getPageConfigJSON(userId, "home");

    if (existingHomeConfig) {
      return { success: true, created: false, config: existingHomeConfig };
    }

    const defaultHomeConfig = await loadSignupDefaults("home.json");
    await updatePageConfig(userId, "home", defaultHomeConfig);

    return { success: true, created: true, config: defaultHomeConfig };
  }));

  app.get("/api/v1/links/collections", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getLinksCollections(userId);
  }));
  app.get("/api/v1/links/home/groups", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getHomeLinkGroups(userId);
  }));
  app.post("/api/v1/links/home/groups", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return createHomeLinkGroup(userId, String(body?.name ?? ""));
  }));
  app.get("/api/v1/links/home", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getHomeLinks(userId);
  }));
  app.get("/api/v1/links/folders", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    void userId;
    return getLinksFolders(String(c.req.query("listId") ?? ""));
  }));
  app.get("/api/v1/links/items", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    void userId;
    return getLinksItems(String(c.req.query("listId") ?? ""), c.req.query("folderId") ?? undefined);
  }));
  app.post("/api/v1/links/items", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return createHomeLinkItem(userId, body?.data ?? {});
  }));
  app.put("/api/v1/links/items/:linkId", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return updateHomeLinkItem(userId, String(c.req.param("linkId") ?? ""), body?.data ?? {});
  }));
  app.delete("/api/v1/links/items/:linkId", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return deleteLinkItem(userId, String(c.req.param("linkId") ?? ""));
  }));
  app.get("/api/v1/links/tags", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    void userId;
    return getLinksTags();
  }));

  app.get("/api/v1/widgets", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getUserWidgets(userId);
  }));
  app.get("/api/v1/widgets/glanceable", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getUserGlanceable(userId);
  }));
  app.get("/api/v1/widgets/glanceables", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getUserGlanceable(userId);
  }));

  app.get("/api/v1/integrations", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    const id = c.req.query("id") ?? undefined;
    const resolveEndpoints = readBool(c.req.query("resolveEndpoints") ?? undefined);
    if (id) {
      return getIntegration(userId, id, resolveEndpoints);
    }
    return listIntegrations(userId);
  }));
  app.post("/api/v1/integrations", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return createIntegration(userId, body?.payload ?? {});
  }));
  app.post("/api/v1/integrations/test-endpoint", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return testIntegrationEndpoint(userId, String(body?.target ?? ""));
  }));
  app.get("/api/v1/integrations/widget-properties", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getWidgetProperties(userId, String(c.req.query("widgetSlug") ?? ""));
  }));
  app.get("/api/v1/integrations/with-widget", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getIntegrationWithWidget(userId, String(c.req.query("widgetKey") ?? ""));
  }));

  app.get("/api/v1/news", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getNewsSubscriptions(userId);
  }));
  app.get("/api/v1/news/feed", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getNewsFeed(userId, c.req.query("category") ?? null);
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

  app.get("/api/v1/monitoringStatus", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getMonitoringStatus(userId, c.req.query("jobId") ?? null);
  }));
  app.post("/api/v1/monitoringStatus", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return runMonitoringStatus(userId, body?.body ?? {});
  }));

  app.post("/api/v1/wallpapers", async (c) => {
    const formData = await c.req.formData();
    const image = formData.get("image") as File | null;
    if (!image) {
      return c.json({ error: "Missing image file" }, 400);
    }

    const token = String(formData.get("token") ?? c.req.query("token") ?? "");

    return c.json(await uploadWallpaper(token, formData));
  });
}