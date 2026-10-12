import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import PocketBase from "pocketbase";

import { getDashwiseSDKConnector, registerDashwiseSDKConnector } from "../lib/pb/pocketbase";

import authRoute from "./auth.route";
import dataRoute from "./data.route";
import sessionsRoute from "./sessions.route";
import systemRoute from "./system.route";

const app = new Hono();
for (const route of [authRoute, dataRoute, sessionsRoute, systemRoute]) app.route("/", route);

// These routes establish authentication or expose public bootstrap metadata.
const publicPaths = new Set([
  "/api/v1/auth/callback", "/api/v1/auth/sso", "/api/v1/auth/login",
  "/api/v1/auth/mfa", "/api/v1/auth/signup", "/api/v1/appConfig", "/api/v1/appInfo",
]);
const protectedRoutes = app.routes.filter((route) => !publicPaths.has(route.path));
const uniqueRoutes = [...new Map(protectedRoutes.map((route) => [`${route.method} ${route.path}`, route])).values()];

describe("protected REST API authentication", () => {
  let previousConnector: ReturnType<typeof getDashwiseSDKConnector>;
  beforeEach(() => {
    previousConnector = getDashwiseSDKConnector();
    const pb = new PocketBase("http://localhost");
    registerDashwiseSDKConnector({
      async getSuperuserClient() {
        return {
          filter: pb.filter.bind(pb),
          collection() {
            return {
              async getFullList() { return []; },
              async getFirstListItem() { throw new Error("Session not found"); },
            };
          },
        };
      },
      createServerClient() {
        return {
          collection(name: string) {
            return {
              async getOne(id: string) {
                if (name === "linkRssFeeds" && id === "audit-id") {
                  return {
                    id,
                    user: "rss-feed-owner",
                    name: "Protected feed",
                    listId: "list-id",
                    tagIds: [],
                    linkIds: ["link-id"],
                    requiresAuth: true,
                  };
                }
                throw new Error("Record not found");
              },
            };
          },
        };
      },
    } as never);
  });
  afterEach(() => registerDashwiseSDKConnector(previousConnector));
  for (const route of uniqueRoutes) {
    test(`${route.method} ${route.path} rejects missing, legacy, and unknown session credentials`, async () => {
      for (const token of [null, "eyJhbGciOiJIUzI1NiJ9.legacy.signature", "dws_unknown-session"]) {
        const path = route.path.replace(/:[A-Za-z]+/g, "audit-id");
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (token) headers.Authorization = `Bearer ${token}`;
        let body: Record<string, unknown> = {};
        if (path === "/api/v1/auth/change-password") {
          body = { oldPassword: "old-password", newPassword: "new-password", confirmPassword: "new-password" };
        } else if (path === "/api/v1/auth/validate-auth") {
          body = token ? { token } : {};
        } else if (path === "/api/v1/auth/update-user-property") {
          body = { auth: token ? { token } : {}, propertyName: "name", propertyValue: "Audit" };
        } else if (path === "/api/v1/wallpapers") {
          body = { contentBase64: "aGVsbG8=", fileName: "audit.png", mimeType: "image/png" };
        }
        const url = new URL(path, "http://localhost");
        if (path === "/api/v1/wallpapers") url.searchParams.set("fileName", "audit.png");
        const response = await app.request(url.toString(), {
          method: route.method,
          headers,
          ...(route.method === "GET" ? {} : { body: JSON.stringify(body) }),
        });
        // This destructive dev utility is absent outside the dev environment.
        const expectedStatus = path === "/api/v1/links/dev/user-links" && response.status === 404 ? 404 : 401;
        expect(response.status).toBe(expectedStatus);
      }
    });
  }
});
