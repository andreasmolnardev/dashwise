import { resolve } from "node:path";

import { createPublicFileServer } from "./lib/public-files";

import { Hono } from "hono";
import { upgradeWebSocket, websocket } from "hono/bun";
import { cors } from "hono/cors";
import { Client as SshClient } from "ssh2";

import { isSessionActive } from "./lib/data/sessions";
import { trackSessionConnection, type SessionConnection } from "./lib/session-connections";

import { config } from "./lib/config";

import { authenticateDeviceSocket, closeDeviceRequest, createDeviceRequest } from "./lib/device-code";
import { jobsApi, registerJobsCron } from "./jobs/index";
import { startPocketbase } from "./pocketbase";
import { createLogger } from "./lib/logger";
import { getMonitoringSshHostById, getMonitoringSshHostCredentials, getSystemAgentHostById } from "./lib/data/monitoring";
import "./lib/integrations-sdk/builtins";
import { startSdkIntegrationRuntime, stopSdkIntegrationRuntime } from "./lib/integrations-sdk/runtime";
import { systemAgentClient } from "./lib/systemAgent";
import { requireAuth } from "./routes/shared";
import authRoute from "./routes/auth.route";
import sessionsRoute from "./routes/sessions.route";
import systemRoute from "./routes/system.route";
import dataRoute from "./routes/data.route";
import activityWebSocketRoute from "./routes/activity.websocket";
import mediaRoute from "./routes/media.route";

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


const shutdown = async () => {
  logger.info("Shutting down");
  systemAgentClient.stop();
  await stopSdkIntegrationRuntime();
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
app.route("/", sessionsRoute);
app.route("/", systemRoute);
app.route("/", dataRoute);
app.route("/", mediaRoute);

app.get("/health", (c) => c.json({ status: "ok" }));

// Device login never accepts credentials in the URL. The first WebSocket frame
// is only a protocol acknowledgement; the server owns the hidden secret.
app.get("/api/v1/auth/device-code", upgradeWebSocket((c) => {
  let requestId = "";
  return {
    onOpen(_event, ws) {
      try {
        if (config.ENVIRONMENT === "production" && !["https", "wss"].includes((c.req.header("x-forwarded-proto") ?? new URL(c.req.url).protocol.replace(":", "")))) {
          ws.close(1008, "HTTPS is required");
          return;
        }
        const request = createDeviceRequest(ws, c.req.header("x-forwarded-for")?.split(",")[0] ?? "unknown", c.req.header("user-agent") ?? "unknown");
        requestId = request.id;
        ws.send(JSON.stringify({ type: "device-code", code: request.code, secret: request.secret, requestId: request.id, expiresAt: request.expiresAt }));
      } catch (error) {
        ws.send(JSON.stringify({ type: "error", message: error instanceof Error ? error.message : "Device login unavailable" }));
        ws.close(1013, "Device login unavailable");
      }
    },
    onMessage(event, ws) {
      try {
        const message = JSON.parse(String(event.data));
        if (message.type === "authenticate" && requestId && authenticateDeviceSocket(requestId, String(message.secret ?? ""))) {
          ws.send(JSON.stringify({ type: "authenticated" }));
        } else {
          ws.close(1008, "Invalid device login");
        }
      } catch { ws.close(1008, "Invalid device login"); }
    },
    onClose() { if (requestId) closeDeviceRequest(requestId); },
  };
}));

app.route("/", activityWebSocketRoute);

app.get("/api/v1/monitoring/ssh-hosts/:id/console", upgradeWebSocket((c) => {
  let lifecycle: SessionConnection | undefined;
  let closed = false;
  let ssh: SshClient | null = null;
  let stream: import("ssh2").ClientChannel | null = null;

  const sendJson = async (ws: { send: (data: string) => void }, payload: Record<string, unknown>) => {
    if (!await lifecycle?.ensureValid() || !lifecycle?.isActive()) return;
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      // Socket is already closed.
    }
  };

  const cleanup = () => {
    closed = true;
    lifecycle?.dispose();
    stream?.end();
    stream = null;
    ssh?.end();
    ssh = null;
  };

  return {
    async onOpen(_event, ws) {
      const token = c.req.query("token") || c.req.header("Authorization")?.replace(/^Bearer\s+/i, "") || "";
      const sessionId = c.req.query("sessionId") || c.req.header("x-session-id") || null;
      const hostId = c.req.param("id") || "";

      try {
        const { userId, sessionId: resolvedSessionId } = await requireAuth({ token, sessionId });
        if (closed) return;
        lifecycle = trackSessionConnection({ userId, sessionId: resolvedSessionId,
          validate: () => isSessionActive(userId, resolvedSessionId),
          close: () => { cleanup(); ws.close(1008, "Session ended"); },
        });
        if (!await lifecycle.ensureValid() || !lifecycle?.isActive()) return;
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

        if (!await lifecycle.ensureValid() || !lifecycle?.isActive()) return;
        ssh = new SshClient();
        ssh
          .on("ready", async () => {
            if (!await lifecycle?.ensureValid() || !lifecycle?.isActive()) return;
            sendJson(ws, { type: "status", status: "connected", message: `Connected to ${host.username}@${host.hostname}:${host.port}` });
            ssh?.shell({ term: "xterm-256color", cols: 120, rows: 32 }, (error, channel) => {
              if (error) {
                sendJson(ws, { type: "error", message: error.message });
                ws.close(1011, "SSH shell failed");
                return;
              }

              if (!lifecycle?.isActive()) { channel.end(); return; }
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
    async onMessage(event) {
      if (!await lifecycle?.ensureValid() || !lifecycle?.isActive() || !stream) return;
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
  let lifecycle: SessionConnection | undefined;
  let closed = false;
  const cleanup = () => { closed = true; unsubscribe?.(); lifecycle?.dispose(); };
  return {
    async onOpen(_event, ws) {
      const token = c.req.query("token") || c.req.header("Authorization")?.replace(/^Bearer\s+/i, "") || "";
      const sessionId = c.req.query("sessionId") || c.req.header("x-session-id") || null;
      try {
        const { userId, sessionId: resolvedSessionId } = await requireAuth({ token, sessionId });
        if (closed) return;
        lifecycle = trackSessionConnection({ userId, sessionId: resolvedSessionId,
          validate: () => isSessionActive(userId, resolvedSessionId),
          close: () => { cleanup(); ws.close(1008, "Session ended"); },
        });
        if (!await lifecycle.ensureValid() || !lifecycle?.isActive()) return;
        const host = await getSystemAgentHostById(userId, c.req.param("id") || "");
        if (!host) {
          ws.close(1008, "Monitoring host not found");
          return;
        }
        if (!await lifecycle.ensureValid() || !lifecycle?.isActive()) return;
        unsubscribe = systemAgentClient.subscribe(host.id, async (entry) => {
          if (!await lifecycle?.ensureValid() || !lifecycle?.isActive()) return;
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
      cleanup();
    },
  };
}));

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

const servePublicFile = createPublicFileServer(publicDir);

app.get("/assets/*", async (c) => servePublicFile(new URL(c.req.url).pathname, c.req.raw));
app.get("/favicons/*", async (c) => servePublicFile(new URL(c.req.url).pathname, c.req.raw));
app.get("/fonts/*", async (c) => servePublicFile(new URL(c.req.url).pathname, c.req.raw));
app.get("/icons/*", async (c) => servePublicFile(new URL(c.req.url).pathname, c.req.raw));
app.get("/weather-icons/*", async (c) => servePublicFile(new URL(c.req.url).pathname, c.req.raw));
app.get("/sw.js", async (c) => servePublicFile(new URL(c.req.url).pathname, c.req.raw));
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
app.get("/openapi.json", async (c) => servePublicFile(new URL(c.req.url).pathname, c.req.raw));
app.get("/integrations.json", async (c) => servePublicFile(new URL(c.req.url).pathname, c.req.raw));
app.get("/bangs.js", async (c) => servePublicFile(new URL(c.req.url).pathname, c.req.raw));
app.get("/dashboard-wallpaper.png", async (c) => servePublicFile(new URL(c.req.url).pathname, c.req.raw));
app.get("/dashwise-icon.png", async (c) => servePublicFile(new URL(c.req.url).pathname, c.req.raw));
app.get("/dashwise-icon.svg", async (c) => servePublicFile(new URL(c.req.url).pathname, c.req.raw));
app.get("/dashwise-light.png", async (c) => servePublicFile(new URL(c.req.url).pathname, c.req.raw));
app.get("/dashwise-light.svg", async (c) => servePublicFile(new URL(c.req.url).pathname, c.req.raw));

app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

app.get("*", async (c) => {
  const indexResponse = await servePublicFile("/index.html", c.req.raw);
  if (indexResponse.status !== 404) return indexResponse;

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
// Integration startup may perform slow upstream I/O. Keep it out of the API
// startup path so a single unavailable integration cannot block /health or
// prevent the backend from listening.
void startSdkIntegrationRuntime().catch((error) => {
  logger.error(`Failed to initialize SDK integrations: ${error instanceof Error ? error.message : String(error)}`);
});
void printDevAutoLoginUrl();

export type AppType = typeof app;
export { app };
