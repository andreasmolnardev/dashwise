import type { Hono } from "hono";

import { getAppConfig, getAppInfo } from "@dashwise/sdk/data/app";
import { getLocations } from "@dashwise/sdk/data/misc";
import { getSearchItems } from "@dashwise/sdk/data/searchItems";
import { runPullIcons } from "@dashwise/sdk/data/jobs";

import { jobsApi, validateJobsBasicAuth } from "../jobs/index";
import { readAuthToken, requireAuth, withJson } from "./shared";

export function registerSystemControllers(app: Hono) {
  app.get("/api/v1/appConfig", withJson(() => getAppConfig()));
  app.get("/api/v1/appInfo", withJson(() => getAppInfo()));

  app.get("/api/v1/searchItems", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getSearchItems(userId);
  }));
  app.get("/api/v1/locations", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    void userId;
    return getLocations(c.req.query("q") ?? null);
  }));

  app.get("/api/v1/jobs/searchItems", async (c) => {
    if (!validateJobsBasicAuth(c.req.header("authorization"))) {
      return c.json({ status: "error", message: "Unauthorized" }, 401);
    }

    await jobsApi.runSearchItemsJob("api");
    return c.json({ status: "success" });
  });
  app.get("/api/v1/jobs/pullIcons", async (c) => {
    if (validateJobsBasicAuth(c.req.header("authorization"))) {
      await jobsApi.runPullIconsJob("api");
      return c.json({ status: "success" });
    }

    const { userId } = await requireAuth({ token: readAuthToken(c) });
    void userId;
    const result = await runPullIcons();
    return c.json(result, (result._status ?? 200) as any);
  });

  app.get("/api/v1/weather", async (c) => c.json({}));
  app.get("/api/v1/test/bookmarks", async (c) => c.json({}));
}