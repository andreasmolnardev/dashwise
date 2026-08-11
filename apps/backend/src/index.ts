import { join, resolve } from "node:path";

import { Hono } from "hono";
import { upgradeWebSocket, websocket } from "hono/bun";
import { cors } from "hono/cors";
import { Client as SshClient } from "ssh2";

import { config } from "./lib/config";
import { jobsApi, registerJobsCron } from "./jobs/index";
import { startPocketbase } from "./pocketbase";
import { createLogger } from "./lib/logger";
import { getMonitoringSshHostById, getMonitoringSshHostCredentials, getSystemAgentHostById } from "./lib/data/monitoring";
import { getNotifications } from "./lib/data/notifications/items";
import { listIntegrations } from "./lib/data/integrations";
import { getUpcomingEvents } from "./lib/calendar";
import { systemAgentClient } from "./lib/systemAgent";
import { requireAuth } from "./routes/shared";
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

type SshCredentials =
  | { method: "password"; password: string }
  | { method: "key"; privateKey: string; publicKey?: string; passphrase?: string };


const shutdown = () => {
  logger.info("Shutting down");
  systemAgentClient.stop();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

registerJobsCron();
void systemAgentClient.start();

app.use("*", async (c, next) => {
  const startedAt = performance.now();
  const timestamp = new Date().toISOString();

  try {
    await next();
  } finally {
    const processingTime = Math.round(performance.now() - startedAt);
    if (config.LOG_LEVEL?.trim().toLowerCase() === "info") {
      logger.info(`[${timestamp}] ${c.req.method} ${c.req.path} ${processingTime}ms`);
    }
  }
});

app.use("*", cors({ origin: "*" }));

app.route("/", authRoute);
app.route("/", systemRoute);
app.route("/", dataRoute);

app.get("/health", (c) => c.json({ status: "ok" }));

app.get("/api/v1/activity", upgradeWebSocket((c) => {
  let refreshTimer: ReturnType<typeof setInterval> | undefined;

  return {
    async onOpen(_event, ws) {
      const token = c.req.query("token") || "";
      try {
        const { userId, pb } = await requireAuth({ token });
        const sendSnapshot = async () => {
          const [notificationResult, integrationResult] = await Promise.all([
            getNotifications(userId),
            listIntegrations(userId),
          ]);
          const calendarEvents = (await Promise.all(
            integrationResult.integrations
              .filter((integration) => integration.type === "caldav")
              .map((integration) => getUpcomingEvents(
                integration.environment,
                integration.localData,
                (localData) => pb.collection("integrations").update(integration.id, { localData }).then(() => undefined),
              ).then((events) => events.map((event) => ({ ...event, id: `${integration.id}:${event.id}` }))).catch(() => [])),
          )).flat().filter((event) => new Date(event.start).getTime() >= new Date().setHours(0, 0, 0, 0));
          ws.send(JSON.stringify({ type: "activity:snapshot", notifications: notificationResult.items, calendarEvents }));
        };

        await sendSnapshot();
        refreshTimer = setInterval(() => void sendSnapshot().catch(() => undefined), 30_000);
        (ws as typeof ws & { data: { sendSnapshot: () => Promise<void> } }).data = { sendSnapshot };
      } catch {
        ws.close(1008, "Unauthorized");
      }
    },
    onMessage(event, ws) {
      try {
        const message = JSON.parse(String(event.data));
        if (message.type === "activity:subscribe" || message.type === "activity:refresh") {
          void (ws as typeof ws & { data?: { sendSnapshot: () => Promise<void> } }).data?.sendSnapshot();
        }
      } catch {
        // Ignore unsupported client activity messages.
      }
    },
    onClose() {
      if (refreshTimer) clearInterval(refreshTimer);
    },
  };
}));

app.get("/api/v1/monitoring/ssh-hosts/:id/console", upgradeWebSocket((c) => {
  let ssh: SshClient | null = null;
  let stream: import("ssh2").ClientChannel | null = null;

  const sendJson = (ws: { send: (data: string) => void }, payload: Record<string, unknown>) => {
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      // Socket is already closed.
    }
  };

  const cleanup = () => {
    stream?.end();
    stream = null;
    ssh?.end();
    ssh = null;
  };

  return {
    async onOpen(_event, ws) {
      const token = c.req.query("token") || c.req.header("Authorization")?.replace(/^Bearer\s+/i, "") || "";
      const hostId = c.req.param("id") || "";

      try {
        const { userId } = await requireAuth({ token });
        const host = await getMonitoringSshHostById(userId, hostId);
        if (!host) {
          ws.send(JSON.stringify({ type: "error", message: "SSH host not found" }));
          ws.close(1008, "SSH host not found");
          return;
        }
        const credentials = getMonitoringSshHostCredentials<SshCredentials>(host);
        if (!credentials) {
          sendJson(ws, { type: "error", message: "No SSH credentials are stored for this host." });
          ws.close(1008, "Missing SSH credentials");
          return;
        }

        ssh = new SshClient();
        ssh
          .on("ready", () => {
            sendJson(ws, { type: "status", status: "connected", message: `Connected to ${host.username}@${host.hostname}:${host.port}` });
            ssh?.shell({ term: "xterm-256color", cols: 120, rows: 32 }, (error, channel) => {
              if (error) {
                sendJson(ws, { type: "error", message: error.message });
                ws.close(1011, "SSH shell failed");
                return;
              }

              stream = channel;
              channel.on("data", (data: Buffer) => {
                sendJson(ws, { type: "stdout", data: data.toString("utf8") });
              });
              channel.stderr.on("data", (data: Buffer) => {
                sendJson(ws, { type: "stderr", data: data.toString("utf8") });
              });
              channel.on("close", () => {
                sendJson(ws, { type: "status", status: "closed", message: "SSH shell closed." });
                ws.close(1000, "SSH shell closed");
              });
            });
          })
          .on("error", (error) => {
            sendJson(ws, { type: "error", message: error.message });
            ws.close(1011, "SSH connection failed");
          })
          .on("close", () => {
            sendJson(ws, { type: "status", status: "closed", message: "SSH connection closed." });
          });

        ssh.connect({
          host: host.hostname,
          port: Number(host.port || 22),
          username: host.username,
          password: credentials.method === "password" ? credentials.password : undefined,
          privateKey: credentials.method === "key" ? credentials.privateKey : undefined,
          passphrase: credentials.method === "key" && typeof credentials.passphrase === "string" ? credentials.passphrase : undefined,
          readyTimeout: 15_000,
        });
      } catch (error) {
        ws.send(JSON.stringify({ type: "error", message: error instanceof Error ? error.message : "Unauthorized" }));
        ws.close(1008, "Unauthorized");
      }
    },
    onMessage(event) {
      if (!stream) return;
      try {
        const message = JSON.parse(String(event.data)) as { type?: string; cols?: number; rows?: number; data?: string };

        if (message?.type === "resize" && Number.isFinite(Number(message.cols)) && Number.isFinite(Number(message.rows))) {
          (stream as any).setWindow?.(Number(message.rows), Number(message.cols), 0, 0);
          return;
        }
      } catch {
        // Not JSON, fall through to raw terminal input.
      }

      stream.write(String(event.data));
    },
    onClose() {
      cleanup();
    },
  };
}));

app.get("/api/v1/monitoring/hosts/:id/stats/live", upgradeWebSocket((c) => {
  let unsubscribe: (() => void) | undefined;
  return {
    async onOpen(_event, ws) {
      const token = c.req.query("token") || c.req.header("Authorization")?.replace(/^Bearer\s+/i, "") || "";
      try {
        const { userId } = await requireAuth({ token });
        const host = await getSystemAgentHostById(userId, c.req.param("id") || "");
        if (!host) {
          ws.close(1008, "Monitoring host not found");
          return;
        }
        unsubscribe = systemAgentClient.subscribe(host.id, (entry) => {
          try {
            ws.send(JSON.stringify(entry));
          } catch {
            unsubscribe?.();
          }
        });
      } catch {
        ws.close(1008, "Unauthorized");
      }
    },
    onClose() {
      unsubscribe?.();
    },
  };
}));

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

  await jobsApi.runNewsFeedBuilderJob("webhook", undefined, undefined, feedIds);

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
  const isFont = extension === ".ttf" || extension === ".woff" || extension === ".woff2";
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
      ...(isFont ? { "Cache-Control": "public, max-age=31536000, immutable" } : {}),
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
