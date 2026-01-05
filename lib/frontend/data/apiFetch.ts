export type ApiFetchOpts = {
  token?: string | null;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  qs?: Record<string, string | number | boolean>;
};

async function parseResponse<T = any>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as unknown as T;
  const text = await res.text();
  const json = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const err = new Error(json?.error ?? res.statusText ?? "Request failed");
    (err as any).status = res.status;
    (err as any).body = json;
    throw err;
  }
  return json as T;
}

function buildUrl(url: string, qs?: Record<string, string | number | boolean>) {
  if (!qs || Object.keys(qs).length === 0) return url;
  const params = new URLSearchParams(
    Object.entries(qs).reduce<Record<string, string>>((acc, [k, v]) => {
      acc[k] = String(v);
      return acc;
    }, {})
  ).toString();
  return url + (url.includes("?") ? "&" : "?") + params;
}

export async function apiFetch<T = any>(
  url: string,
  opts?: ApiFetchOpts & { method?: string; body?: any }
): Promise<T> {
  const token = opts?.token ?? (typeof window !== "undefined" ? localStorage.getItem("pb_token") : null);
  const headers: Record<string, string> = {
    ...(opts?.headers ?? {}),
  };

  let body: BodyInit | undefined;
  if (opts?.body !== undefined) {
    headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
    body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
  }

  if (token) headers["Authorization"] = `Bearer ${token}`;

  const finalUrl = buildUrl(url, opts?.qs);

  const res = await fetch(finalUrl, {
    method: opts?.method ?? "GET",
    headers,
    body,
    signal: opts?.signal,
  });

  return parseResponse<T>(res);
}

export const get = <T = any>(url: string, opts?: ApiFetchOpts & { signal?: AbortSignal }) =>
  apiFetch<T>(url, { ...opts, method: "GET" });

export const post = <T = any>(url: string, body?: any, opts?: ApiFetchOpts) =>
  apiFetch<T>(url, { ...opts, method: "POST", body });

export const put = <T = any>(url: string, body?: any, opts?: ApiFetchOpts) =>
  apiFetch<T>(url, { ...opts, method: "PUT", body });

export const patch = <T = any>(url: string, body?: any, opts?: ApiFetchOpts) =>
  apiFetch<T>(url, { ...opts, method: "PATCH", body });

export const del = <T = any>(url: string, opts?: ApiFetchOpts) =>
  apiFetch<T>(url, { ...opts, method: "DELETE" });

export default apiFetch;
