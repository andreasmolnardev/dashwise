import { Hono } from "hono";

import { getAppConfig, getAppInfo } from "@dashwise/sdk/data/app";
import { getLocations } from "@dashwise/sdk/data/misc";
import { getSearchItems } from "@dashwise/sdk/data/searchItems";
import { runPullIcons } from "@dashwise/sdk/data/jobs";

import { jobsApi, validateJobsBasicAuth } from "../jobs/index";
import { readAuthToken, requireAuth, withJson } from "./shared";

const systemRoute = new Hono();

systemRoute.get("/api/v1/appConfig", withJson(() => getAppConfig()));
systemRoute.get("/api/v1/appInfo", withJson(() => getAppInfo()));

systemRoute.get(
  "/api/v1/searchItems",
  withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getSearchItems(userId);
  }),
);
systemRoute.get(
  "/api/v1/locations",
  withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    void userId;
    return getLocations(c.req.query("q") ?? null);
  }),
);

systemRoute.get("/api/v1/jobs/searchItems", async (c) => {
  if (!validateJobsBasicAuth(c.req.header("authorization"))) {
    return c.json({ status: "error", message: "Unauthorized" }, 401);
  }

  await jobsApi.runSearchItemsJob("api");
  return c.json({ status: "success" });
});
systemRoute.get("/api/v1/jobs/pullIcons", async (c) => {
  if (validateJobsBasicAuth(c.req.header("authorization"))) {
    await jobsApi.runPullIconsJob("api");
    return c.json({ status: "success" });
  }

  const { userId } = await requireAuth({ token: readAuthToken(c) });
  void userId;
  const result = await runPullIcons();
  return c.json(result, (result._status ?? 200) as any);
});

systemRoute.get("/api/v1/weather", async (c) => c.json({}));
systemRoute.get("/api/v1/test/bookmarks", async (c) => c.json({}));

export default systemRoute;
