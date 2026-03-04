"use server";

import { ApiActionError } from "@/lib/api/data/auth";
import { loginUser, signupUser, validateAuthToken } from "@/lib/api/data/authRoutes";

type PostOptions = {
  token?: string | null;
  signal?: AbortSignal;
  qs?: Record<string, string | number | boolean>;
};

export async function post<T = any>(path: string, body?: any, opts?: PostOptions): Promise<T> {
  switch (path) {
    case "/auth/login":
      return (await loginUser(body)) as T;
    case "/auth/signup":
      return (await signupUser(body)) as T;
    case "/auth/validate-auth":
      return (await validateAuthToken(opts?.token ?? "")) as T;
    default:
      throw new ApiActionError(`Unsupported POST path: ${path}`, 404, { error: "Not Found" });
  }
}
