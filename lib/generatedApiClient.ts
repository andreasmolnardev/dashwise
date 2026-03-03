/* Auto-generated API client from openapi.json — do not edit directly */
import { get, post, put, patch, del } from './apiClient';

export async function getAppConfig<T = any>(opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  let path = `/appConfig`;
  return get<T>(path, opts);
}

export async function getAppInfo<T = any>(opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  let path = `/appInfo`;
  return get<T>(path, opts);
}

export async function getAuthCallback<T = any>(opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  let path = `/auth/callback`;
  return get<T>(path, opts);
}

export async function postAuthChangepassword<T = any>(body?: any, opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  let path = `/auth/change-password`;
  return post<T>(path, body, opts);
}

export async function deleteAuthDeleteaccount<T = any>(opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  let path = `/auth/delete-account`;
  return del<T>(path, opts);
}

export async function postAuthLogin<T = any>(body?: any, opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  let path = `/auth/login`;
  return post<T>(path, body, opts);
}

export async function postAuthMfa<T = any>(body?: any, opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  let path = `/auth/mfa`;
  return post<T>(path, body, opts);
}

export async function postAuthSignup<T = any>(body?: any, opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  let path = `/auth/signup`;
  return post<T>(path, body, opts);
}

export async function getAuthSso<T = any>(opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  let path = `/auth/sso`;
  return get<T>(path, opts);
}

export async function postAuthValidateauth<T = any>(body?: any, opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  let path = `/auth/validate-auth`;
  return post<T>(path, body, opts);
}

export async function getConfig<T = any>(opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  let path = `/config`;
  return get<T>(path, opts);
}

export async function postConfig<T = any>(body?: any, opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  let path = `/config`;
  return post<T>(path, body, opts);
}

export async function patchConfig<T = any>(body?: any, opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  let path = `/config`;
  return patch<T>(path, body, opts);
}

export async function putConfig<T = any>(body?: any, opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  let path = `/config`;
  return put<T>(path, body, opts);
}

export async function postConfigDeleteunusedlinkgroups<T = any>(body?: any, opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  let path = `/config/delete-unused-linkgroups`;
  return post<T>(path, body, opts);
}

export async function postConfigMovearrayitems<T = any>(body?: any, opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  let path = `/config/move-arrayitems`;
  return post<T>(path, body, opts);
}

export async function getIntegrationsBeszel<T = any>(opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  let path = `/integrations/beszel`;
  return get<T>(path, opts);
}

export async function getIntegrationsBeszelSystemhealthstats<T = any>(opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  let path = `/integrations/beszel/system-healthstats`;
  return get<T>(path, opts);
}

export async function postIntegrationsDashdot<T = any>(body?: any, opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  let path = `/integrations/dashdot`;
  return post<T>(path, body, opts);
}

export async function getIntegrationsKarakeep<T = any>(opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  let path = `/integrations/karakeep`;
  return get<T>(path, opts);
}

export async function getJobsSearchItems<T = any>(opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  let path = `/jobs/searchItems`;
  return get<T>(path, opts);
}

export async function getJobsPullIcons<T = any>(opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  let path = `/jobs/pullIcons`;
  return get<T>(path, opts);
}

export async function getLocations<T = any>(opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  let path = `/locations`;
  return get<T>(path, opts);
}

export async function getMonitoringStatus<T = any>(opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  let path = `/monitoringStatus`;
  return get<T>(path, opts);
}

export async function postMonitoringStatus<T = any>(body?: any, opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  let path = `/monitoringStatus`;
  return post<T>(path, body, opts);
}

export async function getNews<T = any>(opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  let path = `/news`;
  return get<T>(path, opts);
}

export async function postNewsFeedcategoryrename<T = any>(body?: any, opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  let path = `/news/feed-category-rename`;
  return post<T>(path, body, opts);
}

export async function postNewsFeedrefresh<T = any>(body?: any, opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  let path = `/news/feed-refresh`;
  return post<T>(path, body, opts);
}

export async function getNewsFeedrefresh<T = any>(opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  let path = `/news/feed-refresh`;
  return get<T>(path, opts);
}

export async function postNewsFeedsubscribe<T = any>(body?: any, opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  let path = `/news/feed-subscribe`;
  return post<T>(path, body, opts);
}

export async function postNewsFeedunsubscribe<T = any>(body?: any, opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  let path = `/news/feed-unsubscribe`;
  return post<T>(path, body, opts);
}

export async function postNewsFeedupdate<T = any>(body?: any, opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  let path = `/news/feed-update`;
  return post<T>(path, body, opts);
}

export async function getNotifications<T = any>(opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  let path = `/notifications`;
  return get<T>(path, opts);
}

export async function postNotifications<T = any>(body?: any, opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  let path = `/notifications`;
  return post<T>(path, body, opts);
}

export async function getNotificationsForwarders<T = any>(opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  let path = `/notifications/forwarders`;
  return get<T>(path, opts);
}

export async function postNotificationsForwarders<T = any>(body?: any, opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  let path = `/notifications/forwarders`;
  return post<T>(path, body, opts);
}

export async function putNotificationsForwarders<T = any>(body?: any, opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  let path = `/notifications/forwarders`;
  return put<T>(path, body, opts);
}

export async function deleteNotificationsForwarders<T = any>(opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  let path = `/notifications/forwarders`;
  return del<T>(path, opts);
}

export async function postNotificationsMarkAsRead<T = any>(body?: any, opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  let path = `/notifications/markAsRead`;
  return post<T>(path, body, opts);
}

export async function postNotificationsByTopic<T = any>(body?: any, pathParams?: { topic: string | number }, opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  let path = `/notifications/{topic}`;
    if (!pathParams || pathParams.topic === undefined) throw new Error('Missing path param topic');
    path = path.replace('{topic}', encodeURIComponent(String(pathParams.topic)));
  return post<T>(path, body, opts);
}

export async function getNotificationsTopics<T = any>(opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  let path = `/notifications/topics`;
  return get<T>(path, opts);
}

export async function postNotificationsTopics<T = any>(body?: any, opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  let path = `/notifications/topics`;
  return post<T>(path, body, opts);
}

export async function postNotificationsTopicTokens<T = any>(body?: any, opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  let path = `/notifications/topicTokens`;
  return post<T>(path, body, opts);
}

export async function getNotificationsTopicTokens<T = any>(opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  let path = `/notifications/topicTokens`;
  return get<T>(path, opts);
}

export async function deleteNotificationsTopicTokens<T = any>(opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  let path = `/notifications/topicTokens`;
  return del<T>(path, opts);
}

export async function getSearchItems<T = any>(opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  let path = `/searchItems`;
  return get<T>(path, opts);
}

export async function getTestBookmarks<T = any>(opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  let path = `/test/bookmarks`;
  return get<T>(path, opts);
}

export async function postWallpapers<T = any>(body?: any, opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  let path = `/wallpapers`;
  return post<T>(path, body, opts);
}

export async function getWallpapers<T = any>(opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  let path = `/wallpapers`;
  return get<T>(path, opts);
}

export async function getWeather<T = any>(opts?: { qs?: Record<string, any>; token?: string | null; signal?: AbortSignal }): Promise<T> {
  let path = `/weather`;
  return get<T>(path, opts);
}
