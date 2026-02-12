/* Auto-generated API client from openapi.json — do not edit directly */
import { get, post, put, patch, del } from './apiClient';

export async function getAppConfig<T = any>(opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  return get<T>(`/appConfig`, opts);
}

export async function getAppInfo<T = any>(opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  return get<T>(`/appInfo`, opts);
}

export async function getAuthValidateAuth<T = any>(opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  return post<T>(`/auth/validate-auth`, undefined, opts);
}

export async function postAuthChangePassword<T = any>(body?: any, opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  return post<T>(`/auth/change-password`, body, opts);
}

export async function deleteAuthDeleteAccount<T = any>(opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  return del<T>(`/auth/delete-account`, opts);
}

export async function postAuthLogin<T = any>(body?: any, opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  return post<T>(`/auth/login`, body, opts);
}

export async function postAuthMfa<T = any>(body?: any, opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  return post<T>(`/auth/mfa`, body, opts);
}

export async function postAuthSignup<T = any>(body?: any, opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  return post<T>(`/auth/signup`, body, opts);
}

export async function getAuthSso<T = any>(opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  return get<T>(`/auth/sso`, opts);
}

export async function getConfig<T = any>(opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  return get<T>(`/config`, opts);
}

export async function postConfig<T = any>(body?: any, opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  return post<T>(`/config`, body, opts);
}

export async function patchConfig<T = any>(body?: any, opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  return patch<T>(`/config`, body, opts);
}

export async function putConfig<T = any>(body?: any, opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  return put<T>(`/config`, body, opts);
}

export async function postConfigDeleteUnusedLinkgroups<T = any>(body?: any, opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  return post<T>(`/config/delete-unused-linkgroups`, body, opts);
}

export async function postConfigMoveArrayitems<T = any>(body?: any, opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  return post<T>(`/config/move-arrayitems`, body, opts);
}

export async function getIntegrationsBeszel<T = any>(opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  return get<T>(`/integrations/beszel`, opts);
}

export async function getIntegrationsBeszelSystemHealthstats<T = any>(opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  return get<T>(`/integrations/beszel/system-healthstats`, opts);
}

export async function postIntegrationsDashdot<T = any>(body?: any, opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  return post<T>(`/integrations/dashdot`, body, opts);
}

export async function getIntegrationsKarakeep<T = any>(opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  return get<T>(`/integrations/karakeep`, opts);
}

export async function getJobsSearchItems<T = any>(opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  return get<T>(`/jobs/searchItems`, opts);
}

export async function getLocations<T = any>(opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  return get<T>(`/locations`, opts);
}

export async function getMonitoringStatus<T = any>(opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  return get<T>(`/monitoringStatus`, opts);
}

export async function getNews<T = any>(opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  return get<T>(`/news`, opts);
}

export async function postNewsFeedCategoryRename<T = any>(body?: any, opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  return post<T>(`/news/feed-category-rename`, body, opts);
}

export async function postNewsFeedRefresh<T = any>(body?: any, opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  return post<T>(`/news/feed-refresh`, body, opts);
}

export async function getNewsFeedRefresh<T = any>(opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  return get<T>(`/news/feed-refresh`, opts);
}

export async function postNewsFeedSubscribe<T = any>(body?: any, opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  return post<T>(`/news/feed-subscribe`, body, opts);
}

export async function postNewsFeedUnsubscribe<T = any>(body?: any, opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  return post<T>(`/news/feed-unsubscribe`, body, opts);
}

export async function postNewsFeedUpdate<T = any>(body?: any, opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  return post<T>(`/news/feed-update`, body, opts);
}

export async function getNotifications<T = any>(opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  return get<T>(`/notifications`, opts);
}

export async function postNotifications<T = any>(body?: any, opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  return post<T>(`/notifications`, body, opts);
}

export async function getNotificationsForwarders<T = any>(opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  return get<T>(`/notifications/forwarders`, opts);
}

export async function postNotificationsForwarders<T = any>(body?: any, opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  return post<T>(`/notifications/forwarders`, body, opts);
}

export async function putNotificationsForwarders<T = any>(body?: any, opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  return put<T>(`/notifications/forwarders`, body, opts);
}

export async function delNotificationsForwarders<T = any>(opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal; body?: any }): Promise<T> {
  // del supports optional body in our apiClient
  return del<T>(`/notifications/forwarders`, opts as any);
}

export async function postNotificationsMarkAsRead<T = any>(body?: any, opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  return post<T>(`/notifications/markAsRead`, body, opts);
}

export async function postNotificationsMarkAllAsRead<T = any>(body?: any, opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  return post<T>(`/notifications/markAllAsRead`, body, opts);
}

export async function postNotificationsTopic<T = any>(pathParams?: { topic: string }, body?: any, opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  if (!pathParams || pathParams.topic === undefined) throw new Error('Missing path param topic');
  const p = `/notifications/${encodeURIComponent(String(pathParams.topic))}`;
  return post<T>(p, body, opts);
}

export async function getNotificationsTopics<T = any>(opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  return get<T>(`/notifications/topics`, opts);
}

export async function postNotificationsTopicTokens<T = any>(body?: any, opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  return post<T>(`/notifications/topicTokens`, body, opts);
}

export async function getNotificationsTopicTokens<T = any>(opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  return get<T>(`/notifications/topicTokens`, opts);
}

export async function delNotificationsTopicTokens<T = any>(opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal; body?: any }): Promise<T> {
  return del<T>(`/notifications/topicTokens`, opts as any);
}

export async function getSearchItems<T = any>(opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  return get<T>(`/searchItems`, opts);
}

export async function getTestBookmarks<T = any>(opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  return get<T>(`/test/bookmarks`, opts);
}

export async function postWallpapers<T = any>(body?: any, opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  return post<T>(`/wallpapers`, body, opts);
}

export async function getWallpapers<T = any>(opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  return get<T>(`/wallpapers`, opts);
}

export async function getWeather<T = any>(opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  return get<T>(`/weather`, opts);
}
