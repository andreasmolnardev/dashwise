import type { Hono } from "hono";

import { getPageConfigJSON, getUserPages, updatePageConfig } from "@dashwise/sdk/data/pageConfig";

import { loadSignupDefaults, normalizePageName, readAuthToken, readJsonBody, requireAuth, withJson } from "./shared";

export function registerPageConfigControllers(app: Hono) {
  app.get("/api/v1/pageConfig", withJson(async (c) => {
    const auth = { token: readAuthToken(c) };
    const { userId } = await requireAuth(auth);
    return getPageConfigJSON(userId, normalizePageName(c.req.query("pageName") ?? undefined));
  }));
  app.get("/api/v1/pageConfig/user-pages", withJson(async (c) => {
    const auth = { token: readAuthToken(c) };
    const { userId } = await requireAuth(auth);
    return getUserPages(userId);
  }));
  app.put("/api/v1/pageConfig", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return updatePageConfig(userId, normalizePageName(body?.pageName), body?.config ?? {});
  }));
  app.post("/api/v1/pageConfig/home", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    const existingHomeConfig = await getPageConfigJSON(userId, "home");

    if (existingHomeConfig) {
      return { success: true, created: false, config: existingHomeConfig };
    }

    const defaultHomeConfig = await loadSignupDefaults("home.json");
    await updatePageConfig(userId, "home", defaultHomeConfig);

    return { success: true, created: true, config: defaultHomeConfig };
  }));
}