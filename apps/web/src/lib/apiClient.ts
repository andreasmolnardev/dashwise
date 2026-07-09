import type { ActionAuth, AuthUserRecord, UserPropertyValue } from "@dashwise/types/sdk";
export type { MonitorRecord } from "@dashwise/types/sdk";
import type {
  NewsFeedDraft,
  NewsFeedItem,
  NewsFeedMetadata,
  NewsSavedArticlesResponse,
  NewsFeedRecord,
  NewsFeedRecordCreateInput,
  NewsFeedRecordUpdateInput,
  NewsFeedsResponse,
  NewsSubscribeInput,
  NewsSubscriptionsResponse,
  NewsUpdateInput,
} from "@dashwise/types/sdk";
import type { PageConfig } from "@dashwise/types/sdk";
import config from "@/lib/config";
import { client } from "./api/client.gen";
import * as sdk from "./api/sdk.gen";

const { getAppConfig, getAppInfo, postAuthLogin, postAuthChangePassword, postAuthSignup, postAuthValidateAuth, deleteAuthDeleteAccount, patchAuthUpdateUserProperty, getLinksCollections, postLinksCollections, putLinksCollectionsByCollectionId, postLinksTags, putLinksTagsByTagId, getLinksHomeGroups, postLinksHomeGroups, putLinksFoldersByFolderIdIcon, getLinksHome, getLinksFolders, postLinksFolders, getLinksItems, getLinksTags, postLinksItems, putLinksItemsByLinkId, deleteLinksItemsByLinkId, postLinksReorder, getIntegrations, postIntegrations, putIntegrationsById, deleteIntegrationsById, postIntegrationsTestEndpoint, getIntegrationsWidgetProperties, getWidgetsByIntegration, postIntegrationsConsumerData, getIntegrationsCaldavEvents, postIntegrationsProxyAction, getWidgets, getGlanceables, getGlanceablesByIntegration, getMonitoringStatus, postMonitoringStatus, getMonitors, getMonitorsById, putMonitorsById, postMonitors, deleteMonitorsById, getNewsFeedRecordsById, postNewsFeedRecords, getNewsSubscriptions, getNewsFeeds, getNewsFeedMetadata, postNewsFeedRefresh, postNewsFeedSubscribe, postNewsFeedUnsubscribe, postNewsFeedUpdate, postNewsFeedRecordsById, postNewsFixMissingTitles, getPageConfig, getPageConfigUserPages, putPageConfig, postPageConfigHome, postPageConfigMigrateLegacy, postPageConfigIntegrationData, getSearchItems, getSearchItemsFrequentlyUsed, postSearchItemsUsageStats, getLocations, getJobsPullIcons, postWallpapers, getNotifications, getNotificationsTopics, postNotificationsTopics, deleteNotificationsTopics, postNotificationsMarkAsRead, postNotificationsTest, getNotificationsTopicTokens, postNotificationsTopicTokens, deleteNotificationsTopicTokens, getNotificationsForwarders, postNotificationsForwarders, putNotificationsForwarders, deleteNotificationsForwarders } = sdk;
export * from "./api/sdk.gen";
export type { GenericObject, Error } from "./api/types.gen";

function getBaseUrl() {
  if (config.backend_url) return config.backend_url;
  return typeof window !== "undefined" ? window.location.origin : "";
}

const apiBasePath = "/api/v1";
client.setConfig({
  baseUrl: (getBaseUrl() ?? "").replace(/\/+$/, "") + apiBasePath,
});

export function backendUrl(path: string) {
  return new URL(path.replace(/^\/+/, ""), getBaseUrl()).toString();
}

export function authHeaders(auth?: ActionAuth | null): Record<string, string> | undefined {
  return auth?.token ? { Authorization: `Bearer ${auth.token}` } : undefined;
}

export type MonitoringSshHostRecord = {
  id: string;
  userId?: string;
  name: string;
  hostname: string;
  port: number;
  username: string;
  authMethod: "password" | "key";
  hasCredential?: boolean;
  status?: string;
  created?: string;
  updated?: string;
};

export type MonitoringSshHostInput = {
  name: string;
  hostname: string;
  port: number;
  username: string;
  authMethod: "password" | "key";
  password?: string;
  publicKey?: string;
  privateKey?: string;
};

export type NewsFeedPageResponse = {
  items: NewsFeedItem[];
  total: number;
  limit: number;
};

function stringifyError(error: unknown) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const maybeError = error as Record<string, unknown>;
    if (typeof maybeError.error === "string") return maybeError.error;
    if (typeof maybeError.message === "string") return maybeError.message;
  }
  return "Request failed";
}

function isWallpaperApiUrl(url: URL) {
  return url.pathname === "/api/v1/wallpapers" || url.pathname.endsWith("/api/v1/wallpapers");
}

export async function extractData<T>(result: { data?: T; error?: unknown }): Promise<T> {
  if (result?.error) {
    throw new Error(stringifyError(result.error));
  }
  return result?.data as T;
}

export async function fetchWallpaperBlob(imageUrl: string, token?: string): Promise<Blob> {
  const url = new URL(imageUrl, getBaseUrl());

  if (!isWallpaperApiUrl(url)) {
    const response = await fetch(url.toString(), {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });

    if (!response.ok) {
      throw new Error("Failed to fetch wallpaper");
    }

    return response.blob();
  }

  const query = Object.fromEntries(url.searchParams.entries());
  const result = await client.get({
    url: "/wallpapers",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    query,
    parseAs: "blob",
  });

  const response = result as { data?: Blob; error?: unknown };
  if (response?.error) {
    throw new Error(stringifyError(response.error));
  }

  return response.data as Blob;
}

// --- App actions ---

export async function getAppConfigAction() {
  return extractData(await getAppConfig());
}

export async function getAppInfoAction(_auth?: { token?: string | null }) {
  return extractData(await getAppInfo());
}

// --- Auth actions ---

export type ChangePasswordRequest = {
  email?: string;
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
};

export type ChangePasswordSuccess = {
  message: string;
  token?: string | null;
};

export type ChangePasswordError = {
  error: string;
};

export type ValidateAuthTokenSuccess = {
  success: true;
  token: string;
  user: AuthUserRecord;
};

export async function changePasswordAction(auth: ActionAuth, body: ChangePasswordRequest) {
  return extractData(await postAuthChangePassword({ body, headers: authHeaders(auth) }));
}

export async function loginUserAction(payload: { email: string; password: string; totp?: string }) {
  return extractData(await postAuthLogin({ body: payload }));
}

export async function signupUserAction(payload: { _name?: string; email: string; password: string; passwordConfirm: string }) {
  return extractData(await postAuthSignup({ body: payload }));
}

export async function validateAuthTokenAction(auth: ActionAuth): Promise<ValidateAuthTokenSuccess> {
  return extractData(await postAuthValidateAuth({ body: auth }));
}

export async function deleteAccountAction(auth: ActionAuth, payload: { email: string; password: string; totp?: string }) {
  return extractData(await deleteAuthDeleteAccount({ body: { auth, payload }, headers: authHeaders(auth) }));
}

export async function updateUserPropertyAction(auth: ActionAuth, propertyName: string, propertyValue: UserPropertyValue): Promise<AuthUserRecord> {
  return extractData(await patchAuthUpdateUserProperty({ body: { auth, propertyName, propertyValue }, headers: authHeaders(auth) })) as Promise<AuthUserRecord>;
}

// --- Links actions ---

export async function getLinksCollectionsAction(auth: ActionAuth) {
  return extractData(await getLinksCollections({ headers: authHeaders(auth) }));
}

export async function createLinksCollectionAction(auth: ActionAuth, data: { name: string; description?: string; icon?: string }) {
  return extractData(await postLinksCollections({ body: data, headers: authHeaders(auth) }));
}

export async function updateLinksCollectionAction(auth: ActionAuth, collectionId: string, data: { name: string; description?: string; icon?: string }) {
  return extractData(await putLinksCollectionsByCollectionId({ path: { collectionId }, body: { auth, data }, headers: authHeaders(auth) }));
}

export async function createLinksTagAction(auth: ActionAuth, data: { name: string; color?: string }) {
  return extractData(await postLinksTags({ body: data, headers: authHeaders(auth) }));
}

export async function updateLinksTagAction(auth: ActionAuth, tagId: string, data: { name: string; color?: string }) {
  return extractData(await putLinksTagsByTagId({ path: { tagId }, body: { auth, data }, headers: authHeaders(auth) }));
}

export async function getHomeLinkGroupsAction(auth: ActionAuth) {
  return extractData(await getLinksHomeGroups({ headers: authHeaders(auth) }));
}

export async function createHomeLinkGroupAction(auth: ActionAuth, name: string) {
  return extractData(await postLinksHomeGroups({ body: { auth, name }, headers: authHeaders(auth) }));
}

export async function updateHomeLinkFolderIconAction(auth: ActionAuth, folderId: string, data: { icon?: string }) {
  return extractData(await putLinksFoldersByFolderIdIcon({ path: { folderId }, body: { auth, data }, headers: authHeaders(auth) }));
}

export async function getHomeLinksAction(auth: ActionAuth) {
  return extractData(await getLinksHome({ headers: authHeaders(auth) }));
}

export async function getLinksFoldersAction(auth: ActionAuth, listId: string) {
  return extractData(await getLinksFolders({ query: { listId }, headers: authHeaders(auth) }));
}

export async function createLinksFolderAction(auth: ActionAuth, data: { list: string; name: string; parentFolder?: string }) {
  return extractData(await postLinksFolders({ body: data, headers: authHeaders(auth) }));
}

export async function getLinksItemsAction(auth: ActionAuth, listId: string, folderId?: string) {
  return extractData(await getLinksItems({ query: { listId, folderId }, headers: authHeaders(auth) }));
}

export async function getLinksTagsAction(auth: ActionAuth) {
  return extractData(await getLinksTags({ headers: authHeaders(auth) }));
}

export async function createLinkItemAction(auth: ActionAuth, data: { url: string; title: string; iconUrl?: string; description?: string; linkGroup?: string; folder?: string; collection?: string; tags?: string[] }) {
  return extractData(await postLinksItems({ body: data, headers: authHeaders(auth) }));
}

export async function updateHomeLinkItemAction(auth: ActionAuth, linkId: string, data: { url?: string; title?: string; iconUrl?: string; description?: string; linkGroup?: string; folder?: string }) {
  return extractData(await putLinksItemsByLinkId({ path: { linkId }, body: data, headers: authHeaders(auth) }));
}

export async function deleteLinkItemAction(auth: ActionAuth, linkId: string) {
  return extractData(await deleteLinksItemsByLinkId({ path: { linkId }, headers: authHeaders(auth) }));
}

export async function updateLinksOrderAction(auth: ActionAuth, items: { id: string; type: "link" | "folder"; position: number }[]) {
  return extractData(await postLinksReorder({ body: { auth, items }, headers: authHeaders(auth) }));
}

// --- Integrations actions ---

export async function getIntegrationsAction(auth: ActionAuth, options?: { id?: string; resolveEndpoints?: boolean }) {
  return extractData(await getIntegrations({ query: { id: options?.id, resolveEndpoints: options?.resolveEndpoints }, headers: authHeaders(auth) }));
}

export async function createIntegrationAction(auth: ActionAuth, payload: { type?: "plugin" | "caldav"; name?: string; source?: string; config: unknown; environment?: unknown }) {
  return extractData(await postIntegrations({ body: payload, headers: authHeaders(auth) }));
}

export async function updateIntegrationAction(auth: ActionAuth, id: string, payload: { name?: string; config?: unknown; environment?: unknown; localData?: any }) {
  return extractData(await putIntegrationsById({ path: { id }, body: payload, headers: authHeaders(auth) }));
}

export async function deleteIntegrationAction(auth: ActionAuth, id: string) {
  return extractData(await deleteIntegrationsById({ path: { id }, headers: authHeaders(auth) }));
}

export async function testIntegrationEndpointAction(auth: ActionAuth, target: string) {
  return extractData(await postIntegrationsTestEndpoint({ body: { auth, target }, headers: authHeaders(auth) }));
}

export async function getWidgetPropertiesAction(auth: ActionAuth, widgetSlug: string) {
  return extractData(await getIntegrationsWidgetProperties({ query: { widgetSlug }, headers: authHeaders(auth) }));
}

export async function getIntegrationWithWidgetAction(auth: ActionAuth, widgetKey: string) {
  return extractData(await getWidgetsByIntegration({ query: { widgetKey }, headers: authHeaders(auth) }));
}

export async function getConsumerDataAction(
  auth: ActionAuth,
  key: string,
  properties?: Record<string, any>,
  options?: {
    type?: "widget" | "glanceable";
    isPreview?: boolean;
    environmentOverrides?: Record<string, string>;
  },
) {
  return extractData(await postIntegrationsConsumerData({
    body: {
      key,
      properties,
      type: options?.type,
      isPreview: options?.isPreview,
      environmentOverrides: options?.environmentOverrides,
    },
    headers: authHeaders(auth),
  }));
}

export async function getIntegrationCalendarEventsAction(auth: ActionAuth, integrationId?: string) {
  return extractData(await getIntegrationsCaldavEvents({ query: { integrationId }, headers: authHeaders(auth) }));
}

export async function proxyIntegrationAction(auth: ActionAuth, searchItemId: string) {
  return extractData(await postIntegrationsProxyAction({ body: { auth, searchItemId }, headers: authHeaders(auth) }));
}

// --- Widgets/Glanceables actions ---

export async function getUserWidgetsAction(auth: ActionAuth) {
  return extractData(await getWidgets({ headers: authHeaders(auth) }));
}

export async function getUserGlanceableAction(auth: ActionAuth) {
  return extractData(await getGlanceables({ headers: authHeaders(auth) }));
}

export async function getUserGlanceablesAction(auth: ActionAuth) {
  return extractData(await getGlanceables({ headers: authHeaders(auth) }));
}

export async function getIntegrationWithGlanceableAction(auth: ActionAuth, glanceableType: string) {
  return extractData(await getGlanceablesByIntegration({ query: { glanceableType }, headers: authHeaders(auth) }));
}

// --- Monitoring actions ---

export async function getMonitoringStatusAction(auth: ActionAuth, jobId?: string | null) {
  return extractData(await getMonitoringStatus({ query: { jobId: jobId ?? undefined }, headers: authHeaders(auth) }));
}

export async function updateMonitoringStatusAction(auth: ActionAuth, body: any) {
  return extractData(await postMonitoringStatus({ body, headers: authHeaders(auth) }));
}

export async function getMonitorsAction(auth: ActionAuth): Promise<MonitorRecord[]> {
  return extractData(await getMonitors({ headers: authHeaders(auth) })) as Promise<MonitorRecord[]>;
}

export async function getMonitorAction(auth: ActionAuth, monitorId: string): Promise<MonitorRecord | null> {
  return extractData(await getMonitorsById({ path: { id: monitorId }, headers: authHeaders(auth) })) as Promise<MonitorRecord | null>;
}

export async function updateMonitorAction(auth: ActionAuth, monitorId: string, data: Record<string, unknown>): Promise<MonitorRecord | null> {
  return extractData(await putMonitorsById({ path: { id: monitorId }, body: data, headers: authHeaders(auth) })) as Promise<MonitorRecord | null>;
}

export async function createMonitorAction(auth: ActionAuth, data: { resourceType?: "link" | "system"; linkId: string; endpoint: string; method?: string; endpointAuth?: unknown; responseUpFilter?: { acceptStatusCodes?: string; acceptBodyProperties?: unknown } }): Promise<MonitorRecord> {
  return extractData(await postMonitors({ body: data, headers: authHeaders(auth) })) as Promise<MonitorRecord>;
}

export async function deleteMonitorAction(auth: ActionAuth, monitorId: string): Promise<void> {
  return extractData(await deleteMonitorsById({ path: { id: monitorId }, headers: authHeaders(auth) }));
}

async function fetchJsonAction<T>(auth: ActionAuth, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(backendUrl(`${apiBasePath}${path}`), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(auth),
      ...(init?.headers || {}),
    },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?._status >= 400) {
    throw new Error(data?.error || data?.message || "Request failed");
  }
  return data as T;
}

export async function getMonitoringSshHostsAction(auth: ActionAuth): Promise<MonitoringSshHostRecord[]> {
  return fetchJsonAction(auth, "/monitoring/ssh-hosts");
}

export async function createMonitoringSshHostAction(auth: ActionAuth, data: MonitoringSshHostInput): Promise<MonitoringSshHostRecord> {
  return fetchJsonAction(auth, "/monitoring/ssh-hosts", { method: "POST", body: JSON.stringify(data) });
}

export async function updateMonitoringSshHostAction(auth: ActionAuth, hostId: string, data: Partial<MonitoringSshHostInput>): Promise<MonitoringSshHostRecord> {
  return fetchJsonAction(auth, `/monitoring/ssh-hosts/${hostId}`, { method: "PUT", body: JSON.stringify(data) });
}

// --- News actions ---

export async function getNewsFeedAction(auth: ActionAuth, feedId?: string | null, limit?: number): Promise<NewsFeedPageResponse> {
  return extractData(await client.get({
    url: "/news/feeds/{id}",
    path: { id: feedId ?? "all" },
    query: limit ? { limit } : undefined,
    headers: authHeaders(auth),
  })) as Promise<NewsFeedPageResponse>;
}

export async function getNewsFeedRecordAction(auth: ActionAuth, feedId?: string | null): Promise<NewsFeedRecord | null> {
  return extractData(await getNewsFeedRecordsById({ path: { id: feedId ?? "all" }, headers: authHeaders(auth) })) as Promise<NewsFeedRecord | null>;
}

export async function createNewsFeedRecordAction(auth: ActionAuth, payload: NewsFeedRecordCreateInput): Promise<NewsFeedRecord | null> {
  return extractData(await postNewsFeedRecords({ body: payload, headers: authHeaders(auth) })) as Promise<NewsFeedRecord | null>;
}

export async function getNewsSubscriptionsAction(auth: ActionAuth): Promise<NewsSubscriptionsResponse> {
  return extractData(await getNewsSubscriptions({ headers: authHeaders(auth) })) as Promise<NewsSubscriptionsResponse>;
}

export async function getNewsFeedsAction(auth: ActionAuth): Promise<NewsFeedsResponse> {
  return extractData(await getNewsFeeds({ headers: authHeaders(auth) })) as Promise<NewsFeedsResponse>;
}

export async function getNewsSavedArticlesAction(auth: ActionAuth, list?: string | null): Promise<NewsSavedArticlesResponse> {
  return extractData(await client.get({
    url: "/news/saved-articles",
    query: list ? { list } : undefined,
    headers: authHeaders(auth),
  })) as Promise<NewsSavedArticlesResponse>;
}

export async function saveNewsArticleAction(auth: ActionAuth, article: NewsFeedItem, list?: string | null) {
  return extractData(await client.post({
    url: "/news/saved-articles",
    body: { article, list },
    headers: authHeaders(auth),
  }));
}

export async function deleteNewsSavedArticleAction(auth: ActionAuth, link: string) {
  return extractData(await client.delete({
    url: "/news/saved-articles",
    body: { link },
    headers: authHeaders(auth),
  }));
}

export async function updateNewsSavedArticleReadStateAction(auth: ActionAuth, link: string, isRead = true) {
  return extractData(await client.patch({
    url: "/news/saved-articles/read",
    body: { link, isRead },
    headers: authHeaders(auth),
  }));
}

export async function deleteNewsSavedArticleListAction(auth: ActionAuth, listId: string) {
  return extractData(await client.delete({
    url: `/news/saved-article-lists/${encodeURIComponent(listId)}`,
    headers: authHeaders(auth),
  }));
}

export async function getNewsFeedMetadataAction(auth: ActionAuth, url: string): Promise<NewsFeedMetadata> {
  return extractData(await getNewsFeedMetadata({ query: { url }, headers: authHeaders(auth) })) as Promise<NewsFeedMetadata>;
}

export async function refreshNewsFeedAction(auth: ActionAuth, feedIds?: string[]) {
  return extractData(await postNewsFeedRefresh({ body: { auth, feedIds }, headers: authHeaders(auth) }));
}

export async function subscribeNewsFeedAction(auth: ActionAuth, sub: NewsSubscribeInput | NewsFeedDraft) {
  return extractData(await postNewsFeedSubscribe({ body: { auth, sub }, headers: authHeaders(auth) }));
}

export async function unsubscribeNewsFeedAction(auth: ActionAuth, feedUrl: string) {
  return extractData(await postNewsFeedUnsubscribe({ body: { auth, feedUrl }, headers: authHeaders(auth) }));
}

export async function updateNewsFeedAction(auth: ActionAuth, payload: NewsUpdateInput | NewsFeedDraft) {
  return extractData(await postNewsFeedUpdate({ body: { auth, payload }, headers: authHeaders(auth) }));
}

export async function updateNewsFeedRecordAction(auth: ActionAuth, payload: NewsFeedRecordUpdateInput) {
  return extractData(await postNewsFeedRecordsById({ path: { id: payload.feedId ?? "all" }, body: payload, headers: authHeaders(auth) }));
}

export async function fixMissingTitlesAction(auth: ActionAuth): Promise<unknown> {
  return extractData(await postNewsFixMissingTitles({ headers: authHeaders(auth) })) as Promise<unknown>;
}

// --- PageConfig actions ---

export type CreateHomePageResponse = {
  config: PageConfig;
  created: boolean;
  success: boolean;
};

export async function getPageConfigAction(auth: ActionAuth, pageName: string | undefined): Promise<PageConfig | null> {
  return extractData(await getPageConfig({ query: { pageName }, headers: authHeaders(auth) })) as Promise<PageConfig | null>;
}

export async function getUserPagesAction(auth: ActionAuth): Promise<Array<{ pageName: string }>> {
  return extractData(await getPageConfigUserPages({ headers: authHeaders(auth) })) as Promise<Array<{ pageName: string }>>;
}

export async function updatePageConfigAction(auth: ActionAuth, pageName: string | undefined, config: PageConfig): Promise<unknown> {
  return extractData(await putPageConfig({ body: { auth, pageName, config }, headers: authHeaders(auth) })) as Promise<unknown>;
}

export async function createHomePageAction(auth: ActionAuth): Promise<CreateHomePageResponse> {
  return extractData(await postPageConfigHome({ body: { auth }, headers: authHeaders(auth) })) as Promise<CreateHomePageResponse>;
}

export async function migrateLegacyPageConfigAction(auth: ActionAuth): Promise<unknown> {
  return extractData(await postPageConfigMigrateLegacy({ body: { auth }, headers: authHeaders(auth) })) as Promise<unknown>;
}

export async function getPageIntegrationDataAction(auth: ActionAuth, pageName?: string): Promise<unknown> {
  return extractData(await postPageConfigIntegrationData({ query: { page: pageName }, headers: authHeaders(auth) })) as Promise<unknown>;
}

// --- SearchItems actions ---

export async function getSearchItemsAction(auth: ActionAuth) {
  return extractData(await getSearchItems({ headers: authHeaders(auth) }));
}

export async function getFrequentlyUsedSearchItemsAction(auth: ActionAuth) {
  return extractData(await getSearchItemsFrequentlyUsed({ headers: authHeaders(auth) }));
}

export async function logSearchItemUsageAction(auth: ActionAuth, id: string, timestamp: string) {
  return extractData(await postSearchItemsUsageStats({ body: { id, timestamp }, headers: authHeaders(auth) }));
}

// --- Misc actions ---

export async function getLocationsAction(auth: ActionAuth, q?: string | null) {
  return extractData(await getLocations({ query: { q: q ?? undefined }, headers: authHeaders(auth) }));
}

export async function runPullIconsAction(auth: ActionAuth) {
  return extractData(await getJobsPullIcons({ headers: authHeaders(auth) }));
}

// --- Wallpaper actions ---

function fileToBase64(file: File) {
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 0x8000;

    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }

    return btoa(binary);
  });
}

export async function uploadWallpaperAction(auth: ActionAuth, formData: FormData) {
  const image = formData.get("image") as File | null;
  const fileName = String(formData.get("fileName") ?? image?.name ?? "wallpaper");
  const convertToWebp = String(formData.get("convertToWebp") ?? "false") === "true";

  if (!image) {
    throw new Error("Missing image file");
  }

  return extractData(await postWallpapers({
    body: {
      auth: { token: auth.token },
      fileName,
      mimeType: image.type || undefined,
      contentBase64: await fileToBase64(image),
      convertToWebp,
    },
    headers: authHeaders(auth),
  }));
}

// --- Notifications actions ---

export async function getNotificationsAction(auth: ActionAuth, unread = false, count = false) {
  return extractData(await getNotifications({ query: { unread, count }, headers: authHeaders(auth) }));
}

export async function getNotificationTopicsAction(auth: ActionAuth) {
  return extractData(await getNotificationsTopics({ headers: authHeaders(auth) }));
}

export async function createNotificationTopicAction(auth: ActionAuth, title: string) {
  return extractData(await postNotificationsTopics({ body: { auth, title }, headers: authHeaders(auth) }));
}

export async function deleteNotificationTopicAction(auth: ActionAuth, topicId: string) {
  return extractData(await deleteNotificationsTopics({ body: { auth, topicId }, headers: authHeaders(auth) }));
}

export async function markNotificationsAsReadAction(auth: ActionAuth, ids: string[]) {
  return extractData(await postNotificationsMarkAsRead({ body: { auth, ids }, headers: authHeaders(auth) }));
}

export async function sendTestNotificationAction(auth: ActionAuth, topicId: string) {
  return extractData(await postNotificationsTest({ body: { auth, topicId }, headers: authHeaders(auth) }));
}

export async function listTopicTokensAction(auth: ActionAuth) {
  return extractData(await getNotificationsTopicTokens({ headers: authHeaders(auth) }));
}

export async function createTopicTokenAction(auth: ActionAuth, body: any) {
  return extractData(await postNotificationsTopicTokens({ body, headers: authHeaders(auth) }));
}

export async function deleteTopicTokenAction(auth: ActionAuth, tokenId: string) {
  return extractData(await deleteNotificationsTopicTokens({ body: { auth, tokenId }, headers: authHeaders(auth) }));
}

export async function getForwardersAction(auth: ActionAuth) {
  return extractData(await getNotificationsForwarders({ headers: authHeaders(auth) }));
}

export async function createForwarderAction(auth: ActionAuth, body: any) {
  return extractData(await postNotificationsForwarders({ body, headers: authHeaders(auth) }));
}

export async function updateForwarderAction(auth: ActionAuth, body: any) {
  return extractData(await putNotificationsForwarders({ body, headers: authHeaders(auth) }));
}

export async function deleteForwarderAction(auth: ActionAuth, forwarderId: string) {
  return extractData(await deleteNotificationsForwarders({ body: { auth, forwarderId }, headers: authHeaders(auth) }));
}
