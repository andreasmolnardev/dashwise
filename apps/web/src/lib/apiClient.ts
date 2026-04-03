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
  query?: (input: any) => Record<string, unknown>;
  body?: (input: any) => unknown;
  params?: (input: any) => { path?: Record<string, string> };
};

function getBaseUrl() {
  if (import.meta.env.DEV) {
    return "http://localhost:3000";
  }

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

  "config.getUserConfigAction": {
    method: "GET",
    path: "/config",
    query: (input) => ({ token: authToken(input?.auth), pageName: input?.pageName }),
  },
  "config.appendConfigArrayItemAction": {
    method: "POST",
    path: "/config",
    body: (input) => input,
  },
  "config.updateConfigPathAction": {
    method: "PATCH",
    path: "/config",
    body: (input) => input,
  },
  "config.replaceUserConfigAction": {
    method: "PUT",
    path: "/config",
    body: (input) => input,
  },
  "config.deleteUnusedLinkgroupsAction": {
    method: "POST",
    path: "/config/delete-unused-linkgroups",
    body: (input) => input,
  },
  "config.moveConfigArrayItemsAction": {
    method: "POST",
    path: "/config/move-arrayitems",
    body: (input) => input,
  },
  "config.migrateLegacyPageConfigAction": {
    method: "POST",
    path: "/config/migrate-legacy-page-config",
    body: (input) => input,
  },

  "pageConfig.getPageConfigAction": {
    method: "GET",
    path: "/pageConfig",
    query: (input) => ({ token: authToken(input?.auth), pageName: input?.pageName }),
  },
  "pageConfig.getUserPagesAction": {
    method: "GET",
    path: "/pageConfig/user-pages",
    query: (input) => ({ token: authToken(input) }),
  },
  "pageConfig.updatePageConfigAction": {
    method: "PUT",
    path: "/pageConfig",
    body: (input) => input,
  },

  "links.getLinksCollectionsAction": {
    method: "GET",
    path: "/links/collections",
    query: (input) => ({ token: authToken(input) }),
  },
  "links.getHomeLinkGroupsAction": {
    method: "GET",
    path: "/links/home/groups",
    query: (input) => ({ token: authToken(input) }),
  },
  "links.createHomeLinkGroupAction": {
    method: "POST",
    path: "/links/home/groups",
    body: (input) => input,
  },
  "links.getHomeLinksAction": {
    method: "GET",
    path: "/links/home",
    query: (input) => ({ token: authToken(input) }),
  },
  "links.getLinksFoldersAction": {
    method: "GET",
    path: "/links/folders",
    query: (input) => ({ token: authToken(input?.auth), listId: input?.listId }),
  },
  "links.getLinksItemsAction": {
    method: "GET",
    path: "/links/items",
    query: (input) => ({ token: authToken(input?.auth), listId: input?.listId, folderId: input?.folderId }),
  },
  "links.getLinksTagsAction": {
    method: "GET",
    path: "/links/tags",
    query: (input) => ({ token: authToken(input) }),
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
    query: (input) => ({ token: authToken(input) }),
  },
  "widgets.getUserGlanceableAction": {
    method: "GET",
    path: "/widgets/glanceable",
    query: (input) => ({ token: authToken(input) }),
  },
  "widgets.getUserGlanceablesAction": {
    method: "GET",
    path: "/widgets/glanceables",
    query: (input) => ({ token: authToken(input) }),
  },

  "integrations.getIntegrationsAction": {
    method: "GET",
    path: "/integrations",
    query: (input) => ({
      token: authToken(input?.auth),
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
    query: (input) => ({ token: authToken(input?.auth), widgetSlug: input?.widgetSlug }),
  },
  "integrations.getIntegrationWithWidgetAction": {
    method: "GET",
    path: "/integrations/with-widget",
    query: (input) => ({ token: authToken(input?.auth), widgetKey: input?.widgetKey }),
  },

  "misc.getLocationsAction": {
    method: "GET",
    path: "/locations",
    query: (input) => ({ token: authToken(input?.auth), q: input?.q }),
  },
  "jobs.runPullIconsAction": {
    method: "GET",
    path: "/jobs/pullIcons",
    query: (input) => ({ token: authToken(input) }),
  },

  "monitoring.getMonitoringStatusAction": {
    method: "GET",
    path: "/monitoringStatus",
    query: (input) => ({ token: authToken(input?.auth), jobId: input?.jobId }),
  },
  "monitoring.updateMonitoringStatusAction": {
    method: "POST",
    path: "/monitoringStatus",
    body: (input) => input,
  },

  "news.getNewsFeedAction": {
    method: "GET",
    path: "/news/feed",
    query: (input) => ({ token: authToken(input?.auth), category: input?.category }),
  },
  "news.getNewsSubscriptionsAction": {
    method: "GET",
    path: "/news",
    query: (input) => ({ token: authToken(input) }),
  },
  "news.refreshNewsFeedAction": {
    method: "POST",
    path: "/news/feed-refresh",
    body: (input) => ({ auth: input }),
  },
  "news.subscribeNewsFeedAction": {
    method: "POST",
    path: "/news/feed-subscribe",
    body: (input) => input,
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

  "notifications.items.getNotificationsAction": {
    method: "GET",
    path: "/notifications",
    query: (input) => ({ token: authToken(input?.auth), unread: input?.unread, count: input?.count }),
  },
  "notifications.items.getNotificationTopicsAction": {
    method: "GET",
    path: "/notifications/topics",
    query: (input) => ({ token: authToken(input) }),
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
    query: (input) => ({ token: authToken(input) }),
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
    query: (input) => ({ token: authToken(input) }),
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
    query: (input) => ({ token: authToken(input) }),
  },
  "wallpapers.uploadWallpaperAction": {
    method: "POST",
    path: "/wallpapers",
    body: (input) => input,
  },
};

function invokeAction(modulePath: string, actionName: string, method: "query" | "mutate", input?: unknown) {
  const route = routes[`${modulePath}.${actionName}`];

  if (!route) {
    throw new Error(`Unsupported OpenAPI action: ${modulePath}.${actionName}`);
  }

  if (method === "query" && route.method !== "GET") {
    throw new Error(`Action is not queryable: ${modulePath}.${actionName}`);
  }

  return requestRoute(route, input);
}

export const trpc = new Proxy(
  {},
  {
    get(_target, modulePath) {
      return new Proxy(
        {},
        {
          get(_moduleTarget, actionName) {
            return {
              query(input: unknown) {
                return invokeAction(String(modulePath), String(actionName), "query", input);
              },
              mutate(input: unknown) {
                return invokeAction(String(modulePath), String(actionName), "mutate", input);
              },
            };
          },
        },
      );
    },
  },
);

export async function callAction<T = unknown>(modulePath: string, actionName: string, args: unknown[] = []): Promise<T> {
  const routeKey = `${modulePath}.${actionName}`;
  const route = routes[routeKey];

  if (!route) {
    throw new Error(`Unsupported OpenAPI action: ${routeKey}`);
  }

  return requestRoute<T>(route, args[0]);
}
