import { promises as fs } from "node:fs";
import { resolve } from "node:path";

import type { Context } from "hono";

import { ApiActionError, requireUserAuth } from "../lib/data/auth";
import { z } from "zod";

import {
  type GetContract,
  validateContractQuery,
  validateContractResponse,
} from "../lib/http/contract";

import { config } from "../lib/config";
import { defaultHomeConfig } from "@dashwise/assets";

export type JsonHandler<C extends (import("hono").Context<any, any, any>) = import("hono").Context> = (c: C) => Promise<unknown> | unknown;

export const authInput = z.object({
  token: z.string().nullable().optional(),
  sessionId: z.string().nullable().optional(),
});

export function normalizePageName(pageName?: string | null) {
  const cleaned = String(pageName ?? "home").trim().toLowerCase();
  return cleaned.length > 0 ? cleaned : "home";
}

export async function loadSignupDefaults(filename: string) {
  const publicPath = resolve(process.cwd(), "public", "defaults", filename);
  try {
    const file = await fs.readFile(publicPath, "utf-8");
    return JSON.parse(file);
  } catch {
    // Try package assets folder as a fallback. The server's CWD may be inside apps/backend,
    // so search upwards a few levels to find the repo-level `packages/assets/defaults`.
    for (let up = 0; up <= 3; up++) {
      try {
        const parts = Array(up).fill("..");
        const pkgPath = resolve(process.cwd(), ...parts, "packages", "assets", "defaults", filename);
        const file = await fs.readFile(pkgPath, "utf-8");
        return JSON.parse(file);
      } catch {
        // continue searching
      }
    }

    // Final fallback for home.json to the bundled default
    if (filename === "home.json") {
      return defaultHomeConfig;
    }

    throw new Error(`Unable to load signup defaults file: ${filename}`);
  }

}


export async function requireAuth(auth: z.infer<typeof authInput>) {
  return requireUserAuth(auth);
}

export function jsonErrorBody(error: unknown) {
  if (error instanceof ApiActionError) {
    return { status: error.status, body: error.body ?? { error: error.message } };
  }

  if (error instanceof Error) {
    return { status: 500, body: { error: error.message } };
  }

  return { status: 500, body: { error: "Internal Server Error" } };
}
/**
 * Wrapper for json route handlers
 */
export function withJson<C extends (import("hono").Context<any, any, any>) = import("hono").Context>(handler: JsonHandler<C>) {
  return async (c: C) => {
    try {
      return c.json(await handler(c));
    } catch (error) {
      const response = jsonErrorBody(error);
      return c.json(response.body, response.status as any);
    }
  };
}

/** Validate request input at the route boundary and responses outside production. */
export function withGetContract<Response extends z.ZodTypeAny>(
  contract: GetContract<Response>,
  handler: (c: Context) => Promise<unknown> | unknown,
) {
  return withJson(async (c) => {
    validateContractQuery(contract, c.req.query());
    return validateContractResponse(contract, await handler(c));
  });
}

export function readAuthToken(c: Context) {
  const authorization = c.req.header("authorization") ?? c.req.header("Authorization");
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    const token = authorization.slice(7).trim();
    if (token) {
      return token;
    }
  }

  return c.req.query("token") ?? c.req.query("authToken") ?? null;
}

export function readAuth(c: Context) {
  return {
    token: readAuthToken(c),
    sessionId: c.req.header("x-session-id") ?? null,
  };
}

export function readSessionMetadata(c: Context) {
  return {
    clientType: c.req.header("x-client-type") ?? undefined,
    platform: c.req.header("x-platform") ?? undefined,
  };
}

export async function readJsonBody<T = Record<string, unknown>>(c: Context): Promise<T> {
  try {
    return await c.req.json();
  } catch {
    return {} as T;
  }
}

export function readBool(value: string | undefined) {
  return value === "true" || value === "1";
}

export function routeRedirectTarget(c: Context) {
  if (c.req.query("redirectTo")) {
    return c.req.query("redirectTo") as string;
  }

  if (config.ENVIRONMENT === "production") {
    return new URL("/", c.req.url).toString();
  }

  return config.DASHWISE_URL;
}
