import apiFetch, {
  get as _get,
  post as _post,
  put as _put,
  patch as _patch,
  del as _del,
} from "./frontend/data/apiFetch";

const BASE = "/api/v1";

function buildPath(path: string) {
  if (!path) return BASE;
  if (path.startsWith(BASE)) return path;
  if (!path.startsWith("/")) path = "/" + path;
  return BASE + path;
}

export const get = <T = any>(path: string, opts?: any) => _get<T>(buildPath(path), opts);
export const post = <T = any>(path: string, body?: any, opts?: any) =>
  _post<T>(buildPath(path), body, opts);
export const put = <T = any>(path: string, body?: any, opts?: any) =>
  _put<T>(buildPath(path), body, opts);
export const patch = <T = any>(path: string, body?: any, opts?: any) =>
  _patch<T>(buildPath(path), body, opts);
export const del = <T = any>(path: string, opts?: any) => _del<T>(buildPath(path), opts);

export default {
  get,
  post,
  put,
  patch,
  del,
  raw: apiFetch,
};

export const postNotifications = <T = any>(body?: any, opts?: any) =>
  post<T>("/notifications", body, opts);

export const postNotificationsTopic = <T = any>(
  topic: string,
  body?: any,
  opts?: any
) => post<T>(`/notifications/${encodeURIComponent(topic)}`, body, opts);
