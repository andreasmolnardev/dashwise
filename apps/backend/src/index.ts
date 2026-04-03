import { join, resolve } from "node:path";

import { Hono } from "hono";
import { cors } from "hono/cors";

import { config } from "./config/env";
import { jobsApi, registerJobsCron } from "./jobs/index";
import { startPocketbase } from "./pocketbase";
import { registerRestRoutes } from "./restRoutes";

const app = new Hono();

const pbProcess = await startPocketbase();

const shutdown = () => {
  console.log("Shutting down...");
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

registerJobsCron();

app.use("*", cors({ origin: "*" }));

registerRestRoutes(app);

app.get("/health", (c) => c.json({ status: "ok" }));

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
