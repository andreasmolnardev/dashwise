import { promises as fs } from "node:fs";
import { resolve } from "node:path";

import type { Context } from "hono";

import { ApiActionError, requireUserAuth } from "@dashwise/sdk/data/auth";
import { z } from "zod";

import { config } from "../lib/config";
import { defaultHomeConfig } from "@dashwise/assets";

export type JsonHandler<C extends (import("hono").Context<any, any, any>) = import("hono").Context> = (c: C) => Promise<unknown> | unknown;

export const authInput = z.object({ token: z.string().nullable().optional() });

export function normalizePageName(pageName?: string | null) {
  const cleaned = String(pageName ?? "home").trim().toLowerCase();
  return cleaned.length > 0 ? cleaned : "home";
}

export async function loadSignupDefaults(filename: string) {
  const defaultPage = await defaultHomeConfig;
  return defaultPage;
  throw new Error(`Unable to load signup defaults file: ${filename}`);
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
  return c.req.query("redirectTo") ?? config.DASHWISE_URL;
}