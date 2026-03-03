import { patch } from "../../apiFetch";
import { patch as apiPatch } from "@/lib/apiClient";

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
  const method = opts?.method ?? "PATCH";
  const urlPath = `/config?path=${encodeURIComponent(path)}`;

  // prefer api client wrapper which prefixes `/api/v1`
  const json = await apiPatch<T>(urlPath, { updatedItem }, { token: opts?.token ?? null, signal: opts?.signal });

  // success
  if (opts?.onSuccess) opts.onSuccess(json);
  if (opts?.dispatchEvent && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("config:updated", { detail: { path, updatedItem, response: json } }));
  }

  return json as T;
}