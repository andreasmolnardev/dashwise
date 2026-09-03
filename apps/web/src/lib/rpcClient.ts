import { hc } from "hono/client";
import type { ActionAuth } from "@dashwise/types/sdk";

import { backendUrl } from "@/lib/apiClient";
import { getClientSessionHeaders } from "@/lib/session";

const rpcClient = hc(backendUrl("/"));

function authHeader(auth?: ActionAuth) {
  return auth?.token
    ? { Authorization: `Bearer ${auth.token}`, ...getClientSessionHeaders(auth.sessionId) }
    : undefined;
}

async function parseRpcResponse<T>(response: Response): Promise<T> {
  if (response.ok) {
    return (await response.json()) as T;
  }

  let message = "Request failed";
  try {
    const payload = (await response.json()) as { error?: string; message?: string };
    message = payload.error ?? payload.message ?? message;
  } catch {
    // Keep fallback message when response is not JSON.
  }

  throw new Error(message);
}

export async function rpcGetAppConfig<T = unknown>() {
  const response = await rpcClient.rpc.app.config.$get();
  return parseRpcResponse<T>(response);
}

export async function rpcGetAppInfo<T = unknown>() {
  const response = await rpcClient.rpc.app.info.$get();
  return parseRpcResponse<T>(response);
}

export async function rpcGetPageConfig<T = unknown>(auth: ActionAuth, pageName?: string) {
  const response = await rpcClient.rpc["page-config"].$get({
    header: authHeader(auth),
    query: { pageName },
  });
  return parseRpcResponse<T>(response);
}

export async function rpcGetUserPages<T = unknown>(auth: ActionAuth) {
  const response = await rpcClient.rpc["page-config"].pages.$get({
    header: authHeader(auth),
  });
  return parseRpcResponse<T>(response);
}

export async function rpcUpdatePageConfig<T = unknown>(
  auth: ActionAuth,
  pageName: string | undefined,
  config: Record<string, unknown>,
) {
  const response = await rpcClient.rpc["page-config"].$put({
    header: authHeader(auth),
    json: { auth, pageName, config },
  });
  return parseRpcResponse<T>(response);
}

export async function rpcCreateHomePage<T = unknown>(auth: ActionAuth) {
  const response = await rpcClient.rpc["page-config"].home.$post({
    header: authHeader(auth),
    json: { auth },
  });
  return parseRpcResponse<T>(response);
}
