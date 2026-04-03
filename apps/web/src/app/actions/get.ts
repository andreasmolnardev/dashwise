import { callAction } from "@/src/lib/action-client";

type GetOptions = {
  token?: string | null;
  signal?: AbortSignal;
  qs?: Record<string, string | number | boolean>;
};

export async function get<T = any>(path: string, opts?: GetOptions): Promise<T> {
  return callAction<T>("get", "get", [path, opts]);
}
