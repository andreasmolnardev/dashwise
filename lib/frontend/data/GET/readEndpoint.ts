export default async function readEndpoint<T = any>(
  path: string,
  opts?: {
    token?: string | null;
    signal?: AbortSignal;
    qs?: Record<string, string | number | boolean>;
  }
): Promise<T> {
  const token =
    opts?.token ?? (typeof window !== "undefined" ? localStorage.getItem("pb_token") : null);

  let url = path;
  if (opts?.qs) {
    const params = new URLSearchParams(
      Object.entries(opts.qs).reduce<Record<string, string>>((acc, [k, v]) => {
        acc[k] = String(v);
        return acc;
      }, {})
    ).toString();
    url += (url.includes("?") ? "&" : "?") + params;
  }

  const res = await fetch(url, {
    method: "GET",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    signal: opts?.signal,
  });

  if (res.status === 204) return undefined as unknown as T; // no content

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
