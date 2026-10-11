import { Hono } from "hono";

import { getAppConfig, getAppInfo } from "../lib/data/app";
import { getLocations } from "../lib/data/misc";
import { runPullIcons } from "../lib/data/jobs";

import { jobsApi, validateJobsBasicAuth } from "../jobs/index";
import { jsonErrorBody, readAuthToken, requireAuth, withGetContract, withJson } from "./shared";
import {
  appConfigContract,
  appInfoContract,
} from "../features/system/system.contract";

const systemRoute = new Hono();

systemRoute.onError((error, c) => {
  const response = jsonErrorBody(error);
  return c.json(response.body, response.status as any);
});

systemRoute.get("/api/v1/appConfig", withGetContract(appConfigContract, () => getAppConfig()));
systemRoute.get("/api/v1/appInfo", withGetContract(appInfoContract, () => getAppInfo()));

systemRoute.get(
  "/api/v1/locations",
  withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    void userId;
    return getLocations(c.req.query("q") ?? null);
  }),
);

systemRoute.get("/api/v1/jobs/shortcuts", async (c) => {
  if (!validateJobsBasicAuth(c.req.header("authorization"))) {
    return c.json({ status: "error", message: "Unauthorized" }, 401);
  }

  await jobsApi.runShortcutsJob("api");
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

systemRoute.get("/api/v1/weather", withJson(async (c) => {
  await requireAuth({ token: readAuthToken(c) });
  return {};
}));
systemRoute.get("/api/v1/test/bookmarks", withJson(async (c) => {
  await requireAuth({ token: readAuthToken(c) });
  return {};
}));

export default systemRoute;
