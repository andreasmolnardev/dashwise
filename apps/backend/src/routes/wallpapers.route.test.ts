import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import wallpapersRoute from "./wallpapers.route";
import { getDashwiseSDKConnector, registerDashwiseSDKConnector } from "../lib/pb/pocketbase";

let previousConnector: ReturnType<typeof getDashwiseSDKConnector>;
beforeEach(() => { previousConnector = getDashwiseSDKConnector(); });
afterEach(() => { registerDashwiseSDKConnector(previousConnector); });

describe("wallpaper device-session authentication", () => {
  test("rejects absent and legacy PocketBase credentials for downloads", async () => {
    for (const token of [undefined, "legacy-pocketbase-token"]) {
      for (const transport of ["header", "query"]) {
        const url = new URL("http://localhost/api/v1/wallpapers?fileName=private.png");
        const headers: Record<string, string> = {};
        if (token && transport === "header") headers.Authorization = `Bearer ${token}`;
        if (token && transport === "query") url.searchParams.set("token", token);
        const response = await wallpapersRoute.fetch(new Request(url.toString(), { headers }));
        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ error: "Unauthorized" });
      }
    }
  });

  test("rejects legacy credentials on JSON uploads through all supported transports", async () => {
    for (const transport of ["header", "body", "query"]) {
      const url = new URL("http://localhost/api/v1/wallpapers");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (transport === "header") headers.Authorization = "Bearer legacy-pocketbase-token";
      if (transport === "query") url.searchParams.set("token", "legacy-pocketbase-token");
      const response = await wallpapersRoute.fetch(new Request(url.toString(), {
        method: "POST",
        headers,
        body: JSON.stringify({
          contentBase64: "aW1hZ2U=",
          auth: transport === "body" ? { token: "legacy-pocketbase-token" } : undefined,
        }),
      }));
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Unauthorized" });
    }
  });

  test("rejects unauthenticated multipart uploads before processing images", async () => {
    const body = new FormData();
    body.append("image", new Blob(["image"]), "private.png");
    const response = await wallpapersRoute.fetch(new Request("http://localhost/api/v1/wallpapers", { method: "POST", body }));
    expect(response.status).toBe(401);
  });
});

test("downloads use session identity and stop serving files after revocation", async () => {
  let revokedAt = "";
  let fileLookups = 0;
  const filters: unknown[] = [];
  const session = {
    id: "session-record", user: "wallpaper-owner", sessionId: "device",
    pocketbaseToken: "internal-token", lastSeenAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    get revokedAt() { return revokedAt; },
  };
  registerDashwiseSDKConnector({
    async getSuperuserClient() {
      return { collection() { return {
        async getFirstListItem() { return session; },
        async update() { return session; },
      }; } };
    },
    createServerClient() {
      let token = "";
      return {
        authStore: { get token() { return token; }, save(value: string) { token = value; } },
        filter(expression: string, values: unknown) { filters.push({ expression, values }); return "scoped-filter"; },
        files: { getURL() { return "data:image/png;base64,aW1hZ2U="; } },
        collection(name: string) { return {
          async authRefresh() { return { record: { id: "wallpaper-owner" } }; },
          async getFirstListItem(filter: string) {
            expect(name).toBe("wallpaperStore");
            expect(filter).toBe("scoped-filter");
            fileLookups++;
            return { image: "private.png" };
          },
        }; },
      };
    },
  } as never);
  const url = "http://localhost/api/v1/wallpapers?fileName=private.png";
  const headers = { Authorization: "Bearer dws_wallpaper-test" };
  const valid = await wallpapersRoute.fetch(new Request(url.toString(), { headers }));
  expect(valid.status).toBe(200);
  expect(valid.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await valid.text()).toBe("image");
  expect(filters).toEqual([{
    expression: "fileName = {:fileName} && userId = {:userId}",
    values: { fileName: "private.png", userId: "wallpaper-owner" },
  }]);
  revokedAt = new Date().toISOString();
  const revoked = await wallpapersRoute.fetch(new Request(url.toString(), { headers }));
  expect(revoked.status).toBe(401);
  expect(fileLookups).toBe(1);
});

test("device-authenticated uploads persist under the authenticated owner", async () => {
  const sharp = (await import("sharp")).default;
  const image = await sharp({ create: { width: 1, height: 1, channels: 4, background: "#ffffff" } }).png().toBuffer();
  let uploaded: FormData | undefined;
  registerDashwiseSDKConnector({
    async getSuperuserClient() {
      return { collection() { return {
        async getFirstListItem() { return {
          id: "session-record", user: "verified-owner", sessionId: "device",
          pocketbaseToken: "internal-token", lastSeenAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        }; },
        async update() { return {}; },
      }; } };
    },
    createServerClient() {
      let token = "";
      return {
        authStore: { get token() { return token; }, save(value: string) { token = value; } },
        collection(name: string) { return {
          async authRefresh() {
            expect(token).toBe("internal-token");
            return { record: { id: "verified-owner" } };
          },
          async getList() { expect(name).toBe("wallpaperStore"); return { items: [] }; },
          async create(form: FormData) {
            expect(name).toBe("wallpaperStore");
            expect(token).toBe("internal-token");
            uploaded = form;
            return { id: "wallpaper" };
          },
        }; },
      };
    },
  } as never);
  const response = await wallpapersRoute.fetch(new Request("http://localhost/api/v1/wallpapers", {
    method: "POST",
    headers: { Authorization: "Bearer dws_upload-test", "Content-Type": "application/json" },
    body: JSON.stringify({ contentBase64: image.toString("base64"), fileName: "private.png", mimeType: "image/png" }),
  }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ success: true, path: "/api/v1/wallpapers?fileName=private.png" });
  expect(uploaded?.get("userId")).toBe("verified-owner");
  expect(uploaded?.get("fileName")).toBe("private.png");
  expect(uploaded?.get("image")).toBeInstanceOf(Blob);
});
