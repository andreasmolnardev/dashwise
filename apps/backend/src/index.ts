import { join, resolve } from "node:path";

import { Hono } from "hono";
import { websocket } from "hono/bun";
import { cors } from "hono/cors";

import { config } from "./lib/config";
import { jobsApi, registerJobsCron } from "./jobs/index";
import { startPocketbase } from "./pocketbase";
import { createLogger } from "./lib/logger";
import authRoute from "./routes/auth.route";
import systemRoute from "./routes/system.route";
import dataRoute from "./routes/data.route";

const app = new Hono();
const devAutoLoginEmail = "testenv@dashwise.local";
const devAutoLoginPassword = "DashwiseTestenv123";
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

const publicDir = resolve(process.cwd(), "dist/public");
const openApiYamlPath = resolve(process.cwd(), "openapi.yaml");

async function servePublicFile(requestPath: string) {
  const relativePath = requestPath.replace(/^\/+/, "");

  if (!relativePath) {
    return new Response("Not found", { status: 404 });
  }

  const assetPath = resolve(publicDir, relativePath);
  const rootPath = `${publicDir}/`;

  if (assetPath !== publicDir && !assetPath.startsWith(rootPath)) {
    return new Response("Not found", { status: 404 });
  }

  const assetFile = Bun.file(assetPath);

  if (!(await assetFile.exists())) {
    return new Response("Not found", { status: 404 });
  }

  const extension = assetPath.slice(assetPath.lastIndexOf(".")).toLowerCase();
  const contentType = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ttf": "font/ttf",
    ".txt": "text/plain; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".xml": "application/xml; charset=utf-8",
  }[extension] || "application/octet-stream";

  return new Response(assetFile, {
    headers: {
      "Content-Type": contentType,
    },
  });
}

app.get("/assets/*", async (c) => servePublicFile(new URL(c.req.url).pathname));
app.get("/favicons/*", async (c) => servePublicFile(new URL(c.req.url).pathname));
app.get("/fonts/*", async (c) => servePublicFile(new URL(c.req.url).pathname));
app.get("/icons/*", async (c) => servePublicFile(new URL(c.req.url).pathname));
app.get("/weather-icons/*", async (c) => servePublicFile(new URL(c.req.url).pathname));
app.get("/sw.js", async (c) => servePublicFile(new URL(c.req.url).pathname));
app.get("/openapi.yaml", async () => {
  const specFile = Bun.file(openApiYamlPath);

  if (!(await specFile.exists())) {
    return new Response("OpenAPI spec not found.", { status: 404 });
  }

  return new Response(specFile, {
    headers: {
      "Content-Type": "application/yaml; charset=utf-8",
    },
  });
});
app.get("/openapi.json", async (c) => servePublicFile(new URL(c.req.url).pathname));
app.get("/integrations.json", async (c) => servePublicFile(new URL(c.req.url).pathname));
app.get("/bangs.js", async (c) => servePublicFile(new URL(c.req.url).pathname));
app.get("/dashboard-wallpaper.png", async (c) => servePublicFile(new URL(c.req.url).pathname));
app.get("/dashwise-icon.png", async (c) => servePublicFile(new URL(c.req.url).pathname));
app.get("/dashwise-icon.svg", async (c) => servePublicFile(new URL(c.req.url).pathname));
app.get("/dashwise-light.png", async (c) => servePublicFile(new URL(c.req.url).pathname));
app.get("/dashwise-light.svg", async (c) => servePublicFile(new URL(c.req.url).pathname));

app.get("*", async () => {
  const indexFile = Bun.file(join(publicDir, "index.html"));

  if (await indexFile.exists()) {
    return new Response(indexFile);
  }

  return new Response("Backend running. Frontend not built.", {
    status: 200,
  });
});

const port = config.PORT;

async function printDevAutoLoginUrl() {
  if (Bun.env.NODE_ENV !== "development") {
    return;
  }

  const apiUrl = `http://127.0.0.1:${port}`;
  const appUrl = Bun.env.NEXT_PUBLIC_APP_URL || "http://localhost:5173";

  try {
    const signupResponse = await fetch(`${apiUrl}/api/v1/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: devAutoLoginEmail,
        password: devAutoLoginPassword,
        passwordConfirm: devAutoLoginPassword,
      }),
    });

    if (![200, 201, 400].includes(signupResponse.status)) {
      logger.warn(`Dev auto-login signup returned HTTP ${signupResponse.status}`);
    }

    const loginResponse = await fetch(`${apiUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: devAutoLoginEmail,
        password: devAutoLoginPassword,
      }),
    });

    if (!loginResponse.ok) {
      logger.warn(`Dev auto-login failed with HTTP ${loginResponse.status}`);
      return;
    }

    const loginData = await loginResponse.json() as { token?: string };
    if (!loginData.token) {
      logger.warn("Dev auto-login response did not include a token");
      return;
    }

    logger.info(`Dev auto-login URL: ${appUrl}/auth?loginToken=${encodeURIComponent(loginData.token)}`);
    logger.info(`Dev credentials: ${devAutoLoginEmail} / ${devAutoLoginPassword}`);
  } catch (error) {
    logger.warn(`Dev auto-login setup failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

Bun.serve({
  hostname: "0.0.0.0",
  port,
  fetch: app.fetch,
  websocket,
});

logger.info(`Running on 0.0.0.0:${port}`);
logger.info(`PocketBase target URL: ${config.PB_URL}`);
void printDevAutoLoginUrl();

export type AppType = typeof app;
export { app };
