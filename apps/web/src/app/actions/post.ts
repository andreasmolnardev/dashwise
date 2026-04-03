import { callAction } from "@/src/lib/action-client";

type PostOptions = {
  token?: string | null;
  signal?: AbortSignal;
  qs?: Record<string, string | number | boolean>;
};

export async function post<T = any>(path: string, body?: any, opts?: PostOptions): Promise<T> {
  return callAction<T>("post", "post", [path, body, opts]);
}
