import { join, resolve } from "node:path";

import { Hono } from "hono";
import { cors } from "hono/cors";

import { config } from "./lib/config";
import { jobsApi, registerJobsCron } from "./jobs/index";
import { startPocketbase } from "./pocketbase";
import { createLogger } from "./lib/logger";
import authRoute from "./routes/auth.route";
import systemRoute from "./routes/system.route";
import dataRoute from "./routes/data.route";

const app = new Hono();
const logger = createLogger("API");

const pbProcess = await startPocketbase();

const shutdown = () => {
  logger.info("Shutting down");
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

registerJobsCron();

app.use("*", cors({ origin: "*" }));

app.route("/", authRoute);
app.route("/", systemRoute);
app.route("/", dataRoute);

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
  const url = new URL(c.req.url);
  const feedIds = [
    ...url.searchParams.getAll("feedIds"),
    ...url.searchParams.getAll("feedId"),
  ]
    .flatMap((entry) => String(entry || "").split(","))
    .map((feedId) => feedId.trim())
    .filter(Boolean);

  if (!feedIds.length) {
    return c.json({ status: "success", message: "No feed IDs specified" });
  }

  for (const feedId of feedIds) {
    await jobsApi.runNewsFeedBuilderJob("webhook", feedId);
  }

  return c.json({ status: "success" });
});

app.post("/api/forward-notifications", async (c) => {
  await jobsApi.runNotificationForwarderJob("api");
  return c.json({ status: "success" });
});

const publicDir = resolve(process.cwd(), "apps/backend/dist/public");

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
  hostname: "0.0.0.0",
  port,
  fetch: app.fetch,
});

logger.info(`Running on 0.0.0.0:${port}`);
logger.info(`PocketBase target URL: ${config.PB_URL}`);
