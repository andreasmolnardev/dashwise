import { updateConfigPathAction } from "@/app/actions/config";

export type WriteOpts = {
  method?: "PATCH" | "PUT" | "POST" | "DELETE";
  token?: string | null;
  pageName?: string;
  signal?: AbortSignal;
  onSuccess?: (resp: any) => void; // callback 
  dispatchEvent?: boolean; // dispatch window custom event "config:updated"
};

export async function writeToConfig<T = any>(
  path: string,
  updatedItem: any,
  opts?: WriteOpts
): Promise<T> {
  const token =
    opts?.token ??
    (typeof window !== "undefined" ? localStorage.getItem("pb_token") : null);

  const json = await updateConfigPathAction({ token }, path, updatedItem, opts?.pageName);

  // success
  if (opts?.onSuccess) opts.onSuccess(json);
  if (opts?.dispatchEvent && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("config:updated", { detail: { path, updatedItem, response: json } }));
  }

  return json as T;
}