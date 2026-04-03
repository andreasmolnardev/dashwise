import { join, resolve } from "node:path";

import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";

import { config } from "./config/env";
import { dispatchAction } from "./action-dispatcher";
import { uploadWallpaperAction } from "./actions/wallpapers";
import { jobsApi, registerJobsCron, validateJobsBasicAuth } from "./jobs/index";
import { startPocketbase } from "./pocketbase";
import { appRouter } from "./router";

const app = new Hono();

const pbProcess = await startPocketbase();

const shutdown = () => {
  console.log("Shutting down...");
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

registerJobsCron();

app.use("/api/trpc/*", trpcServer({ router: appRouter }));

app.post("/api/actions/call", async (c) => {
  const body = await c.req.json();
  const modulePath = body?.modulePath;
  const actionName = body?.actionName;
  const args = Array.isArray(body?.args) ? body.args : [];

  if (typeof modulePath !== "string" || typeof actionName !== "string") {
    return c.json({ error: "modulePath and actionName are required" }, 400);
  }

  try {
    const result = await dispatchAction(modulePath, actionName, args);
    return c.json({ result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Action call failed";
    return c.json({ error: message }, 500);
  }
});

app.post("/api/actions/wallpapers/upload", async (c) => {
  const formData = await c.req.formData();
  const token = c.req.header("x-auth-token") ?? null;
  const result = await uploadWallpaperAction({ token }, formData);
  return c.json(result);
});

app.get("/health", (c) => c.json({ status: "ok" }));

app.get("/api/v1/jobs/searchItems", async (c) => {
  if (!validateJobsBasicAuth(c.req.header("authorization"))) {
    return c.json({ status: "error", message: "Unauthorized" }, 401);
  }
  await jobsApi.runSearchItemsJob("api");
  return c.json({ status: "success" });
});

app.get("/api/v1/jobs/pullIcons", async (c) => {
  if (!validateJobsBasicAuth(c.req.header("authorization"))) {
    return c.json({ status: "error", message: "Unauthorized" }, 401);
  }
  await jobsApi.runPullIconsJob("api");
  return c.json({ status: "success" });
});

app.get("/webhook/statusMonitoringIndexer", async (c) => {
  await jobsApi.runMonitoringIndexerJob("webhook");
  return c.json({ status: "success" });
});

app.get("/webhook/statusMonitoringRunner", async (c) => {
  const source = c.req.query("source");
  const linkId = c.req.query("linkId");
  await jobsApi.runMonitoringRunnerJob("webhook", { source, linkId });
  return c.json({ status: "success" });
});

app.get("/webhook/newsFeedBuilder", async (c) => {
  const feedId = c.req.query("feedId");
  await jobsApi.runNewsFeedBuilderJob("webhook", feedId);
  return c.json({ status: "success" });
});

app.post("/api/forward-notifications", async (c) => {
  await jobsApi.runNotificationForwarderJob("api");
  return c.json({ status: "success" });
});

const publicDir = resolve(process.cwd(), "apps/backend/dist/public");

app.get("/assets/*", async (c) => {
  const assetPath = c.req.path.replace(/^\//, "");
  const file = Bun.file(join(publicDir, assetPath));

  if (!(await file.exists())) {
    return c.notFound();
  }

  return new Response(file);
});

app.get("*", async () => {
  const indexFile = Bun.file(join(publicDir, "index.html"));

  if (await indexFile.exists()) {
    return new Response(indexFile);
  }

  return new Response("Backend running. Frontend not built.", {
    status: 200,
  });
});

const port = Number(process.env.PORT || 3000);

Bun.serve({
  port,
  fetch: app.fetch,
});


console.log(`Dashwise backend running on :${port}`);
console.log(`PocketBase target URL: ${config.PB_URL}`);