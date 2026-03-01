import apiFetch, { get as _get, post as _post, put as _put, patch as _patch, del as _del } from "./frontend/data/apiFetch";

const BASE = "/api/v1";

function buildPath(path: string) {
  if (!path) return BASE;
  if (path.startsWith(BASE)) return path;
  if (!path.startsWith("/")) path = "/" + path;
  return BASE + path;
}

export const get = <T = any>(path: string, opts?: any) => _get<T>(buildPath(path), opts);
export const post = <T = any>(path: string, body?: any, opts?: any) => _post<T>(buildPath(path), body, opts);
export const put = <T = any>(path: string, body?: any, opts?: any) => _put<T>(buildPath(path), body, opts);
export const patch = <T = any>(path: string, body?: any, opts?: any) => _patch<T>(buildPath(path), body, opts);
export const del = <T = any>(path: string, opts?: any) => _del<T>(buildPath(path), opts);

export default {
  get,
  post,
  put,
  patch,
  del,
  raw: apiFetch,
};

// Dynamic proxies to auto-forward to generated high-level functions
// Use these to call e.g. `getWeather()` without importing the generated file directly.
export const getAppConfig = (...args: any[]) => import('./generatedApiClient').then(m => (m as any).getAppConfig(...args));
export const getAppInfo = (...args: any[]) => import('./generatedApiClient').then(m => (m as any).getAppInfo(...args));
export const getAuthValidateAuth = (...args: any[]) => import('./generatedApiClient').then(m => (m as any).getAuthValidateAuth(...args));
export const postAuthChangePassword = (...args: any[]) => import('./generatedApiClient').then(m => (m as any).postAuthChangePassword(...args));
export const deleteAuthDeleteAccount = (...args: any[]) => import('./generatedApiClient').then(m => (m as any).deleteAuthDeleteaccount(...args));
export const postAuthLogin = (...args: any[]) => import('./generatedApiClient').then(m => (m as any).postAuthLogin(...args));
export const postAuthMfa = (...args: any[]) => import('./generatedApiClient').then(m => (m as any).postAuthMfa(...args));
export const postAuthSignup = (...args: any[]) => import('./generatedApiClient').then(m => (m as any).postAuthSignup(...args));
export const getAuthSso = (...args: any[]) => import('./generatedApiClient').then(m => (m as any).getAuthSso(...args));
export const getConfig = (...args: any[]) => import('./generatedApiClient').then(m => (m as any).getConfig(...args));
export const postConfig = (...args: any[]) => import('./generatedApiClient').then(m => (m as any).postConfig(...args));
export const patchConfig = (...args: any[]) => import('./generatedApiClient').then(m => (m as any).patchConfig(...args));
export const putConfig = (...args: any[]) => import('./generatedApiClient').then(m => (m as any).putConfig(...args));
export const postConfigDeleteUnusedLinkgroups = (...args: any[]) => import('./generatedApiClient').then(m => (m as any).postConfigDeleteUnusedLinkgroups(...args));
export const postConfigMoveArrayitems = (...args: any[]) => import('./generatedApiClient').then(m => (m as any).postConfigMoveArrayitems(...args));
export const getIntegrationsBeszel = (...args: any[]) => import('./generatedApiClient').then(m => (m as any).getIntegrationsBeszel(...args));
export const getIntegrationsBeszelSystemHealthstats = (...args: any[]) => import('./generatedApiClient').then(m => (m as any).getIntegrationsBeszelSystemHealthstats(...args));
export const postIntegrationsDashdot = (...args: any[]) => import('./generatedApiClient').then(m => (m as any).postIntegrationsDashdot(...args));
export const getIntegrationsKarakeep = (...args: any[]) => import('./generatedApiClient').then(m => (m as any).getIntegrationsKarakeep(...args));
export const getJobsSearchItems = (...args: any[]) => import('./generatedApiClient').then(m => (m as any).getJobsSearchItems(...args));
export const getJobsPullIcons = (...args: any[]) => import('./generatedApiClient').then(m => (m as any).getJobsPullIcons(...args));
export const getLocations = (...args: any[]) => import('./generatedApiClient').then(m => (m as any).getLocations(...args));
export const getMonitoringStatus = (...args: any[]) => import('./generatedApiClient').then(m => (m as any).getMonitoringStatus(...args));
export const getNews = (...args: any[]) => import('./generatedApiClient').then(m => (m as any).getNews(...args));
export const postNewsFeedCategoryRename = (...args: any[]) => import('./generatedApiClient').then(m => (m as any).postNewsFeedCategoryRename(...args));
export const postNewsFeedRefresh = (...args: any[]) => import('./generatedApiClient').then(m => (m as any).postNewsFeedRefresh(...args));
export const getNewsFeedRefresh = (...args: any[]) => import('./generatedApiClient').then(m => (m as any).getNewsFeedRefresh(...args));
export const postNewsFeedSubscribe = (...args: any[]) => import('./generatedApiClient').then(m => (m as any).postNewsFeedSubscribe(...args));
export const postNewsFeedUnsubscribe = (...args: any[]) => import('./generatedApiClient').then(m => (m as any).postNewsFeedUnsubscribe(...args));
export const postNewsFeedUpdate = (...args: any[]) => import('./generatedApiClient').then(m => (m as any).postNewsFeedUpdate(...args));
export const getNotifications = (...args: any[]) => import('./generatedApiClient').then(m => (m as any).getNotifications(...args));
export const postNotifications = (...args: any[]) => import('./generatedApiClient').then(m => (m as any).postNotifications(...args));
export const getNotificationsForwarders = (...args: any[]) => import('./generatedApiClient').then(m => (m as any).getNotificationsForwarders(...args));
export const postNotificationsForwarders = (...args: any[]) => import('./generatedApiClient').then(m => (m as any).postNotificationsForwarders(...args));
export const putNotificationsForwarders = (...args: any[]) => import('./generatedApiClient').then(m => (m as any).putNotificationsForwarders(...args));
export const delNotificationsForwarders = (...args: any[]) => import('./generatedApiClient').then(m => (m as any).delNotificationsForwarders(...args));
export const postNotificationsMarkAsRead = (...args: any[]) => import('./generatedApiClient').then(m => (m as any).postNotificationsMarkAsRead(...args));
export const postNotificationsMarkAllAsRead = (...args: any[]) => import('./generatedApiClient').then(m => (m as any).postNotificationsMarkAllAsRead(...args));
export const postNotificationsTopic = (...args: any[]) => import('./generatedApiClient').then(m => (m as any).postNotificationsTopic(...args));
export const getNotificationsTopics = (...args: any[]) => import('./generatedApiClient').then(m => (m as any).getNotificationsTopics(...args));
export const postNotificationsTopicTokens = (...args: any[]) => import('./generatedApiClient').then(m => (m as any).postNotificationsTopicTokens(...args));
export const getNotificationsTopicTokens = (...args: any[]) => import('./generatedApiClient').then(m => (m as any).getNotificationsTopicTokens(...args));
export const delNotificationsTopicTokens = (...args: any[]) => import('./generatedApiClient').then(m => (m as any).delNotificationsTopicTokens(...args));
export const getSearchItems = (...args: any[]) => import('./generatedApiClient').then(m => (m as any).getSearchItems(...args));
export const getTestBookmarks = (...args: any[]) => import('./generatedApiClient').then(m => (m as any).getTestBookmarks(...args));
export const postWallpapers = (...args: any[]) => import('./generatedApiClient').then(m => (m as any).postWallpapers(...args));
export const getWallpapers = (...args: any[]) => import('./generatedApiClient').then(m => (m as any).getWallpapers(...args));
export const getWeather = (...args: any[]) => import('./generatedApiClient').then(m => (m as any).getWeather(...args));
