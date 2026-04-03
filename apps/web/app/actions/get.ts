"use server";

import { ApiActionError, requireUserAuth } from "@dashwise/sdk/data/auth";
import { getAppConfig, getAppInfo } from "@dashwise/sdk/data/app";

type GetOptions = {
  token?: string | null;
  signal?: AbortSignal;
  qs?: Record<string, string | number | boolean>;
};

export async function get<T = any>(path: string, opts?: GetOptions): Promise<T> {
  switch (path) {
    case "/appConfig":
      return (await getAppConfig()) as T;
    case "/appInfo": {
      await requireUserAuth({ token: opts?.token ?? null });
      return (await getAppInfo()) as T;
    }
    default:
      throw new ApiActionError(`Unsupported GET path: ${path}`, 404, { error: "Not Found" });
  }
}
