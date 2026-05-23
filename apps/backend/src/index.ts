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
const assetRoots = {
  defaults: resolve(process.cwd(), "../../packages/assets/defaults"),
  integrations: resolve(process.cwd(), "../../packages/assets/integrations"),
} as const;

const { process: pbProcess } = await startPocketbase();
const logger = createLogger("API");


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

async function serveWorkspaceAsset(scope: keyof typeof assetRoots, requestPath: string) {
  const prefix = `/${scope}`;
  const relativePath = requestPath.slice(prefix.length).replace(/^\/+/, "");

  if (!relativePath) {
    return new Response("Specify an asset path.", { status: 404 });
  }

  const assetPath = resolve(assetRoots[scope], relativePath);
  const rootPath = `${assetRoots[scope]}/`;
  console.log(`Serving asset: ${assetPath}`);

  if (assetPath !== assetRoots[scope] && !assetPath.startsWith(rootPath)) {
    return new Response("Not found", { status: 404 });
  }


  const assetFile = Bun.file(assetPath);

  if (!(await assetFile.exists())) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(assetFile);
}

app.get("/defaults", (c) => serveWorkspaceAsset("defaults", new URL(c.req.url).pathname));
app.get("/defaults/*", (c) => serveWorkspaceAsset("defaults", new URL(c.req.url).pathname));
app.get("/integrations", (c) => serveWorkspaceAsset("integrations", new URL(c.req.url).pathname));
app.get("/integrations/*", (c) => serveWorkspaceAsset("integrations", new URL(c.req.url).pathname));

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
