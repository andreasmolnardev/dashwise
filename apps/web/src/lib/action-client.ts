import {
  createTRPCClient,
  httpBatchLink,
  TRPCClientError,
} from "@trpc/client";
import type { AppRouter } from "@dashwise/api-types";
import config from "@/lib/config";

/**
 * Resolve backend base URL
 */
function getBaseUrl() {
  if (import.meta.env.DEV) {
    return "http://localhost:3000";
  }

  return config.app_base_url;
}

/**
 * Build full backend URL
 */
export function backendUrl(path: string) {
  return new URL(path.replace(/^\/+/, ""), getBaseUrl()).toString();
}

/**
 * tRPC client
 */
export const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: backendUrl("/api/trpc"),
      headers() {
        return {
          // Example:
          // Authorization: `Bearer ${token}`,
        };
      },
    }),
  ],
});

/**
 * Generic wrapper (⚠️ use with care)
 * NOTE: This bypasses full tRPC type safety
 */
export async function callAction<T = unknown>(
  modulePath: string,
  actionName: string,
  args: unknown[] = []
): Promise<T> {
  try {
    const module = (trpc as any)[modulePath];

    if (!module) {
      throw new Error(`Invalid module: ${modulePath}`);
    }

    const procedure = module[actionName];

    if (!procedure?.mutate) {
      throw new Error(`Invalid tRPC procedure: ${modulePath}.${actionName}`);
    }

    return await procedure.mutate(args);
  } catch (err) {
    if (err instanceof TRPCClientError) {
      throw new Error(err.message);
    }
    throw err;
  }
}

/**
 * File upload (FormData via fetch)
 */
export async function uploadWallpaperViaBackend<T = unknown>(
  token: string | null | undefined,
  formData: FormData
): Promise<T> {
  const response = await fetch(
    backendUrl("/api/actions/wallpapers/upload"),
    {
      method: "POST",
      headers: {
        ...(token ? { "x-auth-token": token } : {}),
      },
      body: formData,
    }
  );

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as T;
}