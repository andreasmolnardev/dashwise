import createClient from "openapi-fetch";
import type { paths } from "@dashwise/api-types";
import type { ActionAuth } from "@dashwise/sdk/data/auth";
import config from "@/lib/config";

const apiClient = createClient<paths>({
  baseUrl: backendUrl("/api/v1"),
});

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type RouteConfig = {
  method: HttpMethod;
  path: keyof paths;
  auth?: (input: any) => string | null;
  query?: (input: any) => Record<string, unknown>;
  body?: (input: any) => unknown;
  params?: (input: any) => { path?: Record<string, string> };
};

function getBaseUrl() {
  return config.app_base_url;
}

export function backendUrl(path: string) {
  return new URL(path.replace(/^\/+/, ""), getBaseUrl()).toString();
}

function compactRecord<T extends Record<string, unknown>>(record: T) {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

function authToken(input: ActionAuth | null | undefined) {
  return input?.token ?? null;
}

function stringifyError(error: unknown) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const maybeError = error as Record<string, unknown>;
    if (typeof maybeError.error === "string") return maybeError.error;
    if (typeof maybeError.message === "string") return maybeError.message;
  }
  return "Request failed";
}

async function requestRoute<T = unknown>(route: RouteConfig, input?: any): Promise<T> {
  const options: any = {};

  const token = route.auth?.(input);
  if (token) {
    options.headers = {
      ...(options.headers ?? {}),
      Authorization: `Bearer ${token}`,
    };
  }

  if (route.params) {
    options.params = route.params(input);
  }

  if (route.query) {
    options.params = {
      ...(options.params ?? {}),
      query: compactRecord(route.query(input)),
    };
  }

  if (route.method !== "GET") {
    options.body = route.body ? route.body(input) : input;
  }

  let response: any;
  switch (route.method) {
    case "GET":
      response = await apiClient.GET(route.path as any, options);
      break;
    case "POST":
      response = await apiClient.POST(route.path as any, options);
      break;
    case "PUT":
      response = await apiClient.PUT(route.path as any, options);
      break;
    case "PATCH":
      response = await apiClient.PATCH(route.path as any, options);
      break;
    case "DELETE":
      response = await apiClient.DELETE(route.path as any, options);
      break;
  }

  if (response?.error) {
    throw new Error(stringifyError(response.error));
  }

  return response?.data as T;
}

function getRoute(modulePath: string, actionName: string) {
  const route = routes[`${modulePath}.${actionName}`];

  if (!route) {
    throw new Error(`Unsupported API action: ${modulePath}.${actionName}`);
  }

  return route;
}

const routes: Record<string, RouteConfig> = {
  "app.getAppConfigAction": { method: "GET", path: "/appConfig" },
  "app.getAppInfoAction": { method: "GET", path: "/appInfo" },

  "auth.changePasswordAction": {
    method: "POST",
    path: "/auth/change-password",
    body: (input) => input,
  },
  "auth.loginUserAction": {
    method: "POST",
    path: "/auth/login",
    body: (input) => input,
  },
  "auth.signupUserAction": {
    method: "POST",
    path: "/auth/signup",
    body: (input) => input,
  },
  "auth.validateAuthTokenAction": {
    method: "POST",
    path: "/auth/validate-auth",
    body: (input) => input,
  },
  "auth.deleteAccountAction": {
    method: "DELETE",
    path: "/auth/delete-account",
    body: (input) => input,
  },
  "auth.updateUserPropertyAction": {
    method: "PATCH",
    path: "/auth/update-user-property",
    body: (input) => input,
  },

  "pageConfig.getPageConfigAction": {
    method: "GET",
    path: "/pageConfig",
    auth: (input) => authToken(input?.auth),
    query: (input) => ({ pageName: input?.pageName }),
  },
  "pageConfig.getUserPagesAction": {
    method: "GET",
    path: "/pageConfig/user-pages",
    auth: (input) => authToken(input),
  },
  "pageConfig.createHomePageAction": {
    method: "POST",
    path: "/pageConfig/home",
    body: (input) => input,
  },
  "pageConfig.updatePageConfigAction": {
    method: "PUT",
    path: "/pageConfig",
    body: (input) => input,
  },
  "pageConfig.getPageIntegrationDataAction": {
    method: "POST",
    path: "/pageConfig/integrationData" as any,
    auth: (input) => authToken(input?.auth),
    query: (input) => ({ page: input?.pageName }),
    body: () => undefined,
  },

  "links.getLinksCollectionsAction": {
    method: "GET",
    path: "/links/collections",
    auth: (input) => authToken(input),
  },
  "links.createLinksCollectionAction": {
    method: "POST",
    path: "/links/collections",
    body: (input) => input,
  },
  "links.updateLinksCollectionAction": {
    method: "PUT",
    path: "/links/collections/{collectionId}" as any,
    params: (input) => ({ path: { collectionId: String(input?.collectionId ?? "") } }),
    body: (input) => ({ auth: input?.auth, data: input?.data }),
  },
  "links.getHomeLinkGroupsAction": {
    method: "GET",
    path: "/links/home/groups",
    auth: (input) => authToken(input),
  },
  "links.createHomeLinkGroupAction": {
    method: "POST",
    path: "/links/home/groups",
    body: (input) => input,
  },
  "links.updateHomeLinkFolderIconAction": {
    method: "PUT",
    path: "/links/folders/{folderId}/icon" as any,
    params: (input) => ({ path: { folderId: String(input?.folderId ?? "") } }),
    body: (input) => ({ auth: input?.auth, data: input?.data }),
  },
  "links.getHomeLinksAction": {
    method: "GET",
    path: "/links/home",
    auth: (input) => authToken(input),
  },
  "links.getLinksFoldersAction": {
    method: "GET",
    path: "/links/folders",
    auth: (input) => authToken(input?.auth),
    query: (input) => ({ listId: input?.listId }),
  },
  "links.createLinksFolderAction": {
    method: "POST",
    path: "/links/folders",
    body: (input) => input,
  },
  "links.getLinksItemsAction": {
    method: "GET",
    path: "/links/items",
    auth: (input) => authToken(input?.auth),
    query: (input) => ({ listId: input?.listId, folderId: input?.folderId }),
  },
  "links.getLinksTagsAction": {
    method: "GET",
    path: "/links/tags",
    auth: (input) => authToken(input),
  },
  "links.createLinksTagAction": {
    method: "POST",
    path: "/links/tags",
    body: (input) => input,
  },
  "links.updateLinksTagAction": {
    method: "PUT",
    path: "/links/tags/{tagId}" as any,
    params: (input) => ({ path: { tagId: String(input?.tagId ?? "") } }),
    body: (input) => ({ auth: input?.auth, data: input?.data }),
  },
  "links.createLinkItemAction": {
    method: "POST",
    path: "/links/items",
    body: (input) => input,
  },
  "links.updateHomeLinkItemAction": {
    method: "PUT",
    path: "/links/items/{linkId}",
    params: (input) => ({ path: { linkId: String(input?.linkId ?? "") } }),
    body: (input) => ({ auth: input?.auth, data: input?.data }),
  },
  "links.deleteLinkItemAction": {
    method: "DELETE",
    path: "/links/items/{linkId}",
    params: (input) => ({ path: { linkId: String(input?.linkId ?? "") } }),
    body: (input) => ({ auth: input?.auth }),
  },

  "widgets.getUserWidgetsAction": {
    method: "GET",
    path: "/widgets",
    auth: (input) => authToken(input),
  },
  "widgets.getUserGlanceableAction": {
    method: "GET",
    path: "/widgets/glanceable",
    auth: (input) => authToken(input),
  },
  "widgets.getUserGlanceablesAction": {
    method: "GET",
    path: "/widgets/glanceables",
    auth: (input) => authToken(input),
  },
  "glanceables.getUserGlanceablesAction": {
    method: "GET",
    path: "/glanceables",
    auth: (input) => authToken(input),
  },
  "widgets.getIntegrationWithWidgetAction": {
    method: "GET",
    path: "/widgets/by-integration",
    auth: (input) => authToken(input?.auth),
    query: (input) => ({ widgetKey: input?.widgetKey }),
  },
  "glanceables.getIntegrationWithGlanceableAction": {
    method: "GET",
    path: "/glanceables/by-integration",
    auth: (input) => authToken(input?.auth),
    query: (input) => ({ glanceableType: input?.glanceableType }),
  },

  "integrations.getIntegrationsAction": {
    method: "GET",
    path: "/integrations",
    auth: (input) => authToken(input?.auth),
    query: (input) => ({
      id: input?.options?.id,
      resolveEndpoints: input?.options?.resolveEndpoints,
    }),
  },
  "integrations.createIntegrationAction": {
    method: "POST",
    path: "/integrations",
    body: (input) => input,
  },
  "integrations.testIntegrationEndpointAction": {
    method: "POST",
    path: "/integrations/test-endpoint",
    body: (input) => input,
  },
  "integrations.getWidgetPropertiesAction": {
    method: "GET",
    path: "/integrations/widget-properties",
    auth: (input) => authToken(input?.auth),
    query: (input) => ({ widgetSlug: input?.widgetSlug }),
  },
  "integrations.getConsumerDataAction": {
    method: "POST",
    path: "/integrations/consumerData",
    auth: (input) => authToken(input?.auth),
    body: (input) => ({
      key: input?.key,
      type: input?.type,
      properties: input?.properties,
      isPreview: input?.isPreview,
    }),
  },
  "integrations.getIntegrationCalendarEventsAction": {
    method: "GET",
    path: "/integrations/caldav/events",
    auth: (input) => authToken(input?.auth),
    query: (input) => ({ integrationId: input?.integrationId }),
  },

  "misc.getLocationsAction": {
    method: "GET",
    path: "/locations",
    auth: (input) => authToken(input?.auth),
    query: (input) => ({ q: input?.q }),
  },
  "jobs.runPullIconsAction": {
    method: "GET",
    path: "/jobs/pullIcons",
    auth: (input) => authToken(input),
  },

  "monitoring.getMonitoringStatusAction": {
    method: "GET",
    path: "/monitoringStatus",
    auth: (input) => authToken(input?.auth),
    query: (input) => ({ jobId: input?.jobId }),
  },
  "monitoring.updateMonitoringStatusAction": {
    method: "POST",
    path: "/monitoringStatus",
    body: (input) => input,
  },
  "monitoring.getMonitorsAction": {
    method: "GET",
    path: "/monitors" as any,
    auth: (input) => authToken(input?.auth),
  },
  "monitoring.getMonitorAction": {
    method: "GET",
    path: "/monitors/{id}" as any,
    auth: (input) => authToken(input?.auth),
    params: (input) => ({ path: { id: String(input?.monitorId ?? "") } }),
  },
    "monitoring.createMonitorAction": {
      method: "POST",
      path: "/monitors" as any,
      body: (input) => input,
    },
    "monitoring.deleteMonitorAction": {
      method: "DELETE",
      path: "/monitors/{id}" as any,
      auth: (input) => authToken(input?.auth),
      params: (input) => ({ path: { id: String(input?.monitorId ?? "") } }),
    },

  "news.getNewsFeedAction": {
    method: "GET",
    path: "/news/feeds/{id}" as any,
    auth: (input) => authToken(input?.auth),
    params: (input) => ({ path: { id: String(input?.feedId ?? "all") } }),
  },
  "news.getNewsFeedRecordAction": {
    method: "GET",
    path: "/news/feed-records/{id}" as any,
    auth: (input) => authToken(input?.auth),
    params: (input) => ({ path: { id: String(input?.feedId ?? "all") } }),
  },
  "news.getNewsFeedMetadataAction": {
    method: "GET",
    path: "/news/feed-metadata" as any,
    auth: (input) => authToken(input?.auth),
    query: (input) => ({ url: input?.url }),
  },
  "news.getNewsSubscriptionsAction": {
    method: "GET",
    path: "/news/subscriptions",
    auth: (input) => authToken(input),
  },
  "news.getNewsFeedsAction": {
    method: "GET",
    path: "/news/feeds",
    auth: (input) => authToken(input),
  },
  "news.refreshNewsFeedAction": {
    method: "POST",
    path: "/news/feed-refresh",
    body: (input) => ({
      auth: input?.auth,
      feedId: input?.feedId,
      feedIds: input?.feedIds,
    }),
  },
  "news.subscribeNewsFeedAction": {
    method: "POST",
    path: "/news/feed-subscribe",
    body: (input) => ({
      auth: input?.auth,
      sub: input?.sub
        ? {
            feedUrl: input.sub.feedUrl,
            name: input.sub.name,
            icon: input.sub.icon,
            feedIds: input.sub.feedIds,
            newFeedTitles: input.sub.newFeedTitles,
          }
        : input?.sub,
    }),
  },
  "news.unsubscribeNewsFeedAction": {
    method: "POST",
    path: "/news/feed-unsubscribe",
    body: (input) => input,
  },
  "news.updateNewsFeedAction": {
    method: "POST",
    path: "/news/feed-update",
    body: (input) => input,
  },
  "news.updateNewsFeedRecordAction": {
    method: "POST",
    path: "/news/feed-records/{id}" as any,
    params: (input) => ({ path: { id: String(input?.feedId ?? "all") } }),
    body: (input) => input,
  },

  "notifications.items.getNotificationsAction": {
    method: "GET",
    path: "/notifications",
    auth: (input) => authToken(input?.auth),
    query: (input) => ({ unread: input?.unread, count: input?.count }),
  },
  "notifications.items.getNotificationTopicsAction": {
    method: "GET",
    path: "/notifications/topics",
    auth: (input) => authToken(input),
  },
  "notifications.items.createNotificationTopicAction": {
    method: "POST",
    path: "/notifications/topics",
    body: (input) => input,
  },
  "notifications.items.markNotificationsAsReadAction": {
    method: "POST",
    path: "/notifications/markAsRead",
    body: (input) => input,
  },
  "notifications.topicTokens.listTopicTokensAction": {
    method: "GET",
    path: "/notifications/topicTokens",
    auth: (input) => authToken(input),
  },
  "notifications.topicTokens.createTopicTokenAction": {
    method: "POST",
    path: "/notifications/topicTokens",
    body: (input) => input,
  },
  "notifications.topicTokens.deleteTopicTokenAction": {
    method: "DELETE",
    path: "/notifications/topicTokens",
    body: (input) => input,
  },
  "notifications.forwarders.getForwardersAction": {
    method: "GET",
    path: "/notifications/forwarders",
    auth: (input) => authToken(input),
  },
  "notifications.forwarders.createForwarderAction": {
    method: "POST",
    path: "/notifications/forwarders",
    body: (input) => input,
  },
  "notifications.forwarders.updateForwarderAction": {
    method: "PUT",
    path: "/notifications/forwarders",
    body: (input) => input,
  },
  "notifications.forwarders.deleteForwarderAction": {
    method: "DELETE",
    path: "/notifications/forwarders",
    body: (input) => input,
  },

  "searchItems.getSearchItemsAction": {
    method: "GET",
    path: "/searchItems",
    auth: (input) => authToken(input),
  },
  "wallpapers.uploadWallpaperAction": {
    method: "POST",
    path: "/wallpapers",
    body: (input) => input,
  },
};

export async function callApiAction<T = unknown>(modulePath: string, actionName: string, input?: unknown): Promise<T> {
  return requestRoute<T>(getRoute(modulePath, actionName), input);
}
