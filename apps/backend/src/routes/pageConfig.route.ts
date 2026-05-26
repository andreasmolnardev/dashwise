import { Hono } from "hono";
import { upgradeWebSocket } from "hono/bun";

import { getPageConfigJSON, getUserPages, updatePageConfig } from "@dashwise/sdk/data/pageConfig";
import { migrateLegacyPageConfig } from "@dashwise/sdk/data/config";
import type { PageConfig } from "@dashwise/sdk/data/pageConfig";
import { resolveConsumerDataForRequest } from "./integrations.route";

import { loadSignupDefaults, normalizePageName, readAuthToken, readJsonBody, requireAuth, withJson } from "./shared";

const FRONTEND_ONLY_WIDGETS = new Set([
  "placeholder",
  "main-clock",
  "glanceable-clock",
  "search-bar",
  "link-view",
]);

const FRONTEND_ONLY_GLANCEABLES = new Set([
  "date",
  "greeting",
  "local-timezone",
  "world-clock",
]);

type PageConsumerCandidate = {
  consumer: "widget" | "glanceable";
  key: string;
  properties: Record<string, any>;
  consumerKey: string;
};

const pageConfigRoute = new Hono();
  pageConfigRoute.get("/api/v1/pageConfig", withJson(async (c) => {
    const auth = { token: readAuthToken(c) };
    const { userId } = await requireAuth(auth);
    return getPageConfigJSON(userId, normalizePageName(c.req.query("pageName") ?? undefined));
  }));
  pageConfigRoute.get("/api/v1/pageConfig/user-pages", withJson(async (c) => {
    const auth = { token: readAuthToken(c) };
    const { userId } = await requireAuth(auth);
    return getUserPages(userId);
  }));
  pageConfigRoute.post("/api/v1/pageConfig/integrationData", withJson(async (c) => {
    const body = await readJsonBody<{ pageName?: string }>(c);
    const auth = await requireAuth({ token: readAuthToken(c) });
    const pageName = normalizePageName(c.req.query("page") ?? body?.pageName ?? undefined);
    const pageConfig = (await getPageConfigJSON(auth.userId, pageName)) ?? {};

    const consumers = collectPageConsumers(pageConfig);
    if (consumers.length === 0) {
      return {
        success: true,
        pageName,
        items: [],
      };
    }

    const sharedRuntimeCache = new Map<string, any>();
    const items = await Promise.all(consumers.map(async (consumer) => {
      try {
        const payload = await resolveConsumerDataForRequest({
          userId: auth.userId,
          pb: auth.pb,
          type: consumer.consumer,
          key: consumer.key,
          properties: consumer.properties,
          isPreview: false,
          sharedRuntimeCache,
        });
        return {
          consumer: consumer.consumer,
          key: consumer.key,
          properties: consumer.properties,
          consumerKey: consumer.consumerKey,
          success: true,
          data: payload.data,
          blueprint: payload.blueprint,
        };
      } catch (error) {
        return {
          consumer: consumer.consumer,
          key: consumer.key,
          properties: consumer.properties,
          consumerKey: consumer.consumerKey,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }));

    return {
      success: true,
      pageName,
      items,
    };
  }));
  pageConfigRoute.get(
    "/api/v1/pageConfig/integrationData",
    upgradeWebSocket((c) => {
      let closed = false;
      let currentStreamId = 0;
      let currentToken = readAuthToken(c) ?? c.req.query("token") ?? null;
      let currentPageName = normalizePageName(
        c.req.query("page") ?? c.req.query("pageName") ?? undefined,
      );

      const sendJson = (ws: { send: (data: string) => void }, payload: unknown) => {
        try {
          ws.send(JSON.stringify(payload));
        } catch {
          // Ignore send errors from closing sockets.
        }
      };

      const streamPageData = async (
        ws: { send: (data: string) => void },
        pageName: string,
        token: string | null,
        streamId: number,
      ) => {
        if (!token) {
          sendJson(ws, { type: "error", error: "Unauthorized" });
          return;
        }

        let auth: Awaited<ReturnType<typeof requireAuth>> | null = null;
        try {
          auth = await requireAuth({ token });
        } catch (err) {
          sendJson(ws, {
            type: "error",
            pageName,
            error: err instanceof Error ? err.message : String(err),
          });
          return;
        }

        const pageConfig = (await getPageConfigJSON(auth.userId, pageName)) ?? {};
        const consumers = collectPageConsumers(pageConfig);

        if (closed || streamId !== currentStreamId) return;

        sendJson(ws, { type: "start", pageName, total: consumers.length });

        if (consumers.length === 0) {
          sendJson(ws, { type: "complete", pageName });
          return;
        }

        const sharedRuntimeCache = new Map<string, any>();
        await Promise.all(
          consumers.map(async (consumer) => {
            const baseItem = {
              consumer: consumer.consumer,
              key: consumer.key,
              properties: consumer.properties,
              consumerKey: consumer.consumerKey,
            };

            try {
              const payload = await resolveConsumerDataForRequest({
                userId: auth.userId,
                pb: auth.pb,
                type: consumer.consumer,
                key: consumer.key,
                properties: consumer.properties,
                isPreview: false,
                sharedRuntimeCache,
              });

              if (closed || streamId !== currentStreamId) return;
              sendJson(ws, {
                type: "consumer",
                pageName,
                item: {
                  ...baseItem,
                  success: true,
                  data: payload.data,
                  blueprint: payload.blueprint,
                },
              });
            } catch (error) {
              if (closed || streamId !== currentStreamId) return;
              sendJson(ws, {
                type: "consumer",
                pageName,
                item: {
                  ...baseItem,
                  success: false,
                  error: error instanceof Error ? error.message : String(error),
                },
              });
            }
          }),
        );

        if (closed || streamId !== currentStreamId) return;
        sendJson(ws, { type: "complete", pageName });
      };

      const startStream = (ws: { send: (data: string) => void }, pageName: string) => {
        currentStreamId += 1;
        const streamId = currentStreamId;
        void streamPageData(ws, pageName, currentToken, streamId);
      };

      return {
        onOpen: (_event, ws) => {
          if (!currentToken) {
            sendJson(ws, { type: "error", error: "Unauthorized" });
            ws.close(1008, "Unauthorized");
            return;
          }
          startStream(ws, currentPageName);
        },
        onMessage: (event, ws) => {
          const raw = event.data;
          const text = typeof raw === "string"
            ? raw
            : new TextDecoder().decode(raw as ArrayBuffer);

          let parsed: any = null;
          try {
            parsed = JSON.parse(text);
          } catch {
            return;
          }

          if (!parsed || parsed.type !== "subscribe") return;
          if (typeof parsed.token === "string" && parsed.token.trim()) {
            currentToken = parsed.token.trim();
          }

          const nextPageName = normalizePageName(parsed.pageName ?? parsed.page ?? undefined);
          currentPageName = nextPageName;
          startStream(ws, nextPageName);
        },
        onClose: () => {
          closed = true;
        },
      };
    }),
  );
  pageConfigRoute.put("/api/v1/pageConfig", withJson(async (c) => {
    const body = await readJsonBody<{ auth?: { token?: string | null }; pageName?: string; config?: PageConfig }>(c);
    const { userId } = await requireAuth(body?.auth ?? {});
    return updatePageConfig(userId, normalizePageName(body?.pageName), body?.config ?? {});
  }));
  pageConfigRoute.post("/api/v1/pageConfig/home", withJson(async (c) => {
    const body = await readJsonBody<{ auth?: { token?: string | null } }>(c);
    const { userId } = await requireAuth(body?.auth ?? {});
    const existingHomeConfig = await getPageConfigJSON(userId, "home");

    if (existingHomeConfig) {
      return { success: true, created: false, config: existingHomeConfig };
    }

    const defaultHomeConfig = await loadSignupDefaults("home.json");
    await updatePageConfig(userId, "home", defaultHomeConfig);

    return { success: true, created: true, config: defaultHomeConfig };
  }));

  pageConfigRoute.post("/api/v1/pageConfig/migrate-legacy", withJson(async (c) => {
    const body = await readJsonBody<{ auth?: { token?: string | null } }>(c);
    const { userId } = await requireAuth(body?.auth ?? {});

    try {
      const result = await migrateLegacyPageConfig(userId);
      return { success: true, result };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }));

export default pageConfigRoute;

function collectPageConsumers(config: PageConfig): PageConsumerCandidate[] {
  const dedupe = new Set<string>();
  const result: PageConsumerCandidate[] = [];

  const push = (
    consumer: "widget" | "glanceable",
    key: string,
    properties: Record<string, any> | null | undefined,
  ) => {
    if (consumer === "glanceable" && FRONTEND_ONLY_GLANCEABLES.has(key)) {
      return;
    }

    const normalizedProps = isPlainObject(properties)
      ? stripWidgetIndex(properties as Record<string, any>)
      : {};
    const consumerKey = `${consumer}:${key}:${stableStringify(normalizedProps)}`;
    if (dedupe.has(consumerKey)) return;
    dedupe.add(consumerKey);
    result.push({ consumer, key, properties: normalizedProps, consumerKey });
  };

  if (isPlainObject(config.columns)) {
    for (const columnRaw of Object.values(config.columns as Record<string, unknown>)) {
      if (!isPlainObject(columnRaw)) continue;
      for (const [widgetKey, widgetConfigRaw] of Object.entries(columnRaw as Record<string, unknown>)) {
        if (FRONTEND_ONLY_WIDGETS.has(widgetKey)) {
          if (widgetKey === "main-clock") {
            collectMainClockGlanceables(widgetConfigRaw).forEach((entry) => {
              push("glanceable", entry.key, entry.properties);
            });
          }
          continue;
        }
        push("widget", widgetKey, isPlainObject(widgetConfigRaw) ? (widgetConfigRaw as Record<string, any>) : {});
      }
    }
  }

  if (Array.isArray(config.glanceables)) {
    for (const entryRaw of config.glanceables) {
      if (!isPlainObject(entryRaw)) continue;
      const type = typeof entryRaw.type === "string" ? entryRaw.type.trim() : "";
      if (!type) continue;
      const { type: _type, ...props } = entryRaw;
      push("glanceable", type, props as Record<string, any>);
    }
  }

  return result;
}

function collectMainClockGlanceables(widgetConfigRaw: unknown) {
  const result: Array<{ key: string; properties: Record<string, any> }> = [];
  if (!isPlainObject(widgetConfigRaw)) return result;
  const glanceables = (widgetConfigRaw as Record<string, any>).glanceables;
  if (!isPlainObject(glanceables)) return result;

  for (const [key, propertiesRaw] of Object.entries(glanceables as Record<string, unknown>)) {
    const normalizedKey = String(key ?? "").trim();
    if (!normalizedKey) continue;
    if (FRONTEND_ONLY_GLANCEABLES.has(normalizedKey)) continue;
    result.push({
      key: normalizedKey,
      properties: isPlainObject(propertiesRaw) ? (propertiesRaw as Record<string, any>) : {},
    });
  }

  return result;
}

function stableStringify(value: Record<string, any>) {
  const sorted = Object.keys(value)
    .sort()
    .reduce<Record<string, any>>((acc, key) => {
      acc[key] = value[key];
      return acc;
    }, {});
  return JSON.stringify(sorted);
}

function stripWidgetIndex(value: Record<string, any>) {
  const { index: _index, _rev: _rev, ...rest } = value;
  return rest;
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
