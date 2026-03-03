import { get } from "@/lib/apiClient";

export default async function readEndpoint<T = any>(
  path: string,
  opts?: {
    token?: string | null;
    signal?: AbortSignal;
    qs?: Record<string, string | number | boolean>;
  }
): Promise<T> {
  return get<T>(path, { token: opts?.token ?? null, signal: opts?.signal, qs: opts?.qs });
}
