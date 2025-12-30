export type WriteOpts = {
  method?: "PATCH" | "PUT" | "POST" | "DELETE";
  token?: string | null;
  signal?: AbortSignal;
  onSuccess?: (resp: any) => void; // callback 
  dispatchEvent?: boolean; // dispatch window custom event "config:updated"
};

export async function writeToConfig<T = any>(
  path: string,
  updatedItem: any,
  opts?: WriteOpts
): Promise<T> {
  const token = opts?.token ?? (typeof window !== "undefined" ? localStorage.getItem("pb_token") : null);
  const method = opts?.method ?? "PATCH";
  const url = `/api/v1/config?path=${encodeURIComponent(path)}`;

  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ updatedItem }),
    signal: opts?.signal,
  });

  if (res.status === 204) {
    // no content — still treat as success
    const voidResp = undefined as unknown as T;
    if (opts?.onSuccess) opts.onSuccess(voidResp);
    if (opts?.dispatchEvent && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("config:updated", { detail: { path, updatedItem } }));
    }
    return voidResp;
  }

  const text = await res.text();
  const json = text ? JSON.parse(text) : undefined;

  if (!res.ok) {
    const err = new Error(json?.error ?? res.statusText ?? "Request failed");
    (err as any).status = res.status;
    (err as any).body = json;
    throw err;
  }

  // success
  if (opts?.onSuccess) opts.onSuccess(json);
  if (opts?.dispatchEvent && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("config:updated", { detail: { path, updatedItem, response: json } }));
  }

  return json as T;
}