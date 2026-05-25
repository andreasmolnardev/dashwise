import { Hono } from "hono";
import { randomUUID } from "crypto";

import {
  createIntegration,
  getIntegration,
  getIntegrationWithConsumer,
  getWidgetProperties,
  listIntegrations,
  testIntegrationEndpoint,
  updateIntegration,
  deleteIntegration,
} from "@dashwise/sdk/data/integrations";
import { ApiActionError } from "@dashwise/sdk/data/auth";
import { getSuperuserPB } from "@dashwise/sdk/lib/pocketbase";
import {
  flattenToEnv,
  interpolateString,
  resolveGlanceableRuntimeData,
  resolveStringWithCasts,
  resolveWidgetProperties,
  resolveWidgetRuntimeData,
} from "@dashwise/integrationskit/data/resolveProperties";
import type {
  EndpointRuntimeCacheAdapter,
  ResolvedEndpointData,
} from "@dashwise/integrationskit/data/getEndpointData";

import { readAuthToken, readBool, readJsonBody, requireAuth, withJson } from "./shared";
import { config } from "src/lib/config";
import { getUpcomingEvents } from "src/lib/calendar";

type ConsumerType = "widget" | "glanceable";
type CachePolicy = "strict" | "cache-first";

type IntegrationCacheConfig = {
  policy: CachePolicy;
  retentionSeconds: number;
};

type CacheRecord = {
  value: unknown;
  retentionSeconds: number | null;
  invalidatesAt: number | null;
  createdAt: number;
};

const integrationsRoute = new Hono();
  integrationsRoute.get("/api/v1/integrations", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    const id = c.req.query("id") ?? undefined;
    const resolveEndpoints = readBool(c.req.query("resolveEndpoints") ?? undefined);
    if (id) {
      return getIntegration(userId, id, resolveEndpoints);
    }
    return listIntegrations(userId);
  }));
  integrationsRoute.post("/api/v1/integrations", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return createIntegration(userId, body?.payload ?? {});
  }));
  integrationsRoute.put("/api/v1/integrations/:id", withJson(async (c) => {
    const id = c.req.param("id")!;
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return updateIntegration(userId, id, body?.payload ?? {});
  }));
  integrationsRoute.delete("/api/v1/integrations/:id", withJson(async (c) => {
    const id = c.req.param("id")!;
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return deleteIntegration(userId, id);
  }));
  integrationsRoute.post("/api/v1/integrations/test-endpoint", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return testIntegrationEndpoint(userId, String(body?.target ?? ""));
  }));
  integrationsRoute.post("/api/v1/integrations/proxyAction", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    const searchItemId = String(body?.searchItemId ?? body?.id ?? "").trim();

    if (!searchItemId) {
      throw new ApiActionError("Missing searchItemId", 400, { error: "Missing searchItemId" });
    }

    const pb = await getSuperuserPB();
    const record = await pb.collection("searchItems").getOne(searchItemId);
    if (!record || record.user !== userId) {
      throw new ApiActionError("Unauthorized", 403, { error: "Unauthorized" });
    }

    const action = parseProxyAction(record.action);
    if (!action || !action.url) {
      throw new ApiActionError("Unsupported proxy action", 400, { error: "Unsupported proxy action" });
    }

    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(action.headers ?? {})) {
      headers[key] = String(value ?? "");
    }

    if (action.auth && !Object.keys(headers).some((k) => k.toLowerCase() === "authorization")) {
      headers.Authorization = action.auth;
    }

    let requestBody: string | undefined;
    if (action.body !== undefined && action.body !== null) {
      requestBody = typeof action.body === "string" ? action.body : JSON.stringify(action.body);
      if (!Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) {
        headers["content-type"] = "application/json";
      }
    }

    const response = await fetch(action.url, {
      method: "POST",
      headers,
      body: requestBody,
      ...(config.ALLOW_SSL ? ({ tls: { rejectUnauthorized: false } } as any) : {}),
    } as any);

    const responseBody = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      body: responseBody,
    };
  }));
  integrationsRoute.get("/api/v1/integrations/widget-properties", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getWidgetProperties(userId, String(c.req.query("widgetSlug") ?? ""));
  }));
  integrationsRoute.get("/api/v1/integrations/consumerData", withJson(async (c) => {
    const auth = await requireAuth({ token: readAuthToken(c) });
    const typeRaw = String(c.req.query("type") ?? "").trim().toLowerCase();
    const key = String(c.req.query("key") ?? "").trim();
    const properties = parseInputQuery(c.req.query("input") ?? null);

    if (!key) {
      throw new ApiActionError("Missing key", 400, { error: "Missing key" });
    }

    try {
      const type = parseConsumerType(typeRaw || null);
      return await resolveConsumerData({
        userId: auth.userId,
        pb: auth.pb,
        type,
        key,
        properties,
        isPreview: false,
      });
    } catch (e) {
      console.error("[integrations/consumerData] GET Error:", e);
      throw e;
    }
  }));

  integrationsRoute.post("/api/v1/integrations/consumerData", withJson(async (c) => {
    const auth = await requireAuth({ token: readAuthToken(c) });
    const body = await readJsonBody<any>(c);
    const key = String(body?.key ?? "").trim();
    const typeRaw = typeof body?.type === "string" ? body.type : null;
    const isPreview = Boolean(body?.isPreview);
    const properties = parsePropertiesBody(body?.properties);

    if (!key) {
      throw new ApiActionError("Missing key", 400, { error: "Missing key" });
    }

    try {
      return await resolveConsumerData({
        userId: auth.userId,
        pb: auth.pb,
        type: parseConsumerType(typeRaw),
        key,
        properties,
        isPreview,
      });
    } catch (e) {
      console.error("[integrations/consumerData] POST Error:", e);
      throw e;
    }
  }));

integrationsRoute.get("/api/v1/integrations/caldav/events", withJson(async (c) => {
  const { userId, pb } = await requireAuth({ token: readAuthToken(c) });
  const integrationId = c.req.query("integrationId") ?? undefined;

  const updateLocalData = async (integrationId: string, localData: Record<string, unknown>) => {
    await pb.collection("integrations").update(integrationId, { localData });
  };

  if (integrationId) {
    const integration = await getIntegration(userId, integrationId);
    if (!integration) {
      throw new ApiActionError("Integration not found", 404, { error: "Not found" });
    }
    console.log("[caldav] Fetching with integration env:", JSON.stringify((integration as any).environment));
    const events = await getUpcomingEvents(
      (integration as any).environment,
      (integration as any).localData,
      (ld) => updateLocalData(integrationId, ld)
    );
    return { events };
  }

  const { integrations } = await listIntegrations(userId);
  const caldavIntegrations = integrations.filter((i) => i.type === "caldav");

  if (caldavIntegrations.length === 0) {
    return { events: [] };
  }

  const allEvents = await Promise.all(
    caldavIntegrations.map(async (integration) => {
      const events = await getUpcomingEvents(
        integration.environment,
        integration.localData,
        (ld) => updateLocalData(integration.id, ld)
      );
      return events;
    })
  );

  const mergedEvents = allEvents.flat();
  return { events: mergedEvents };
}));

export default integrationsRoute;

function parseInputQuery(raw: string | null): Record<string, any> {
  if (!raw || !raw.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    if (isPlainObject(parsed)) {
      return parsed as Record<string, any>;
    }
    return {};
  } catch {
    throw new ApiActionError("Invalid input", 400, {
      error: "input must be valid JSON object",
    });
  }
}

type ProxyActionDefinition = {
  type: "post";
  url?: string;
  auth?: string;
  headers?: Record<string, string>;
  body?: unknown;
};

function parseProxyAction(raw: unknown): ProxyActionDefinition | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();

  if (trimmed.toLowerCase().startsWith("post:")) {
    const url = trimmed.slice(5).trim();
    return { type: "post", url };
  }

  if (!trimmed.startsWith("{")) return null;

  try {
    const parsed = JSON.parse(trimmed);
    if (!isPlainObject(parsed)) return null;
    const type = String(parsed.type ?? "").trim().toLowerCase();
    if (type !== "post") return null;

    const headers = isPlainObject(parsed.headers)
      ? (parsed.headers as Record<string, string>)
      : undefined;

    return {
      type: "post",
      url: typeof parsed.url === "string" ? parsed.url : undefined,
      auth: typeof parsed.auth === "string" ? parsed.auth : undefined,
      headers,
      body: parsed.body,
    };
  } catch {
    return null;
  }
}

async function resolveConsumerData(
  opts: {
    userId: string;
    pb: any;
    type: ConsumerType | null;
    key: string;
    properties: Record<string, any>;
    isPreview: boolean;
    sharedRuntimeCache?: Map<string, any>;
    sharedEndpointCache?: Map<string, ResolvedEndpointData>;
  },
): Promise<any> {
  const user = await getAuthUserRecord(opts.pb, opts.userId);
  if (opts.type === "widget") {
    return resolveWidgetConsumer({
      userId: opts.userId,
      key: opts.key,
      properties: opts.properties,
      isPreview: opts.isPreview,
      user,
      sharedEndpointCache: opts.sharedEndpointCache,
      sharedRuntimeCache: opts.sharedRuntimeCache,
    });
  }

  if (opts.type === "glanceable") {
    return resolveGlanceableConsumer({
      userId: opts.userId,
      key: opts.key,
      properties: opts.properties,
      isPreview: opts.isPreview,
      user,
      sharedEndpointCache: opts.sharedEndpointCache,
      sharedRuntimeCache: opts.sharedRuntimeCache,
    });
  }

  try {
    return await resolveWidgetConsumer({
      userId: opts.userId,
      key: opts.key,
      properties: opts.properties,
      isPreview: opts.isPreview,
      user,
      sharedEndpointCache: opts.sharedEndpointCache,
      sharedRuntimeCache: opts.sharedRuntimeCache,
    });
  } catch (error) {
    if (!isApiNotFound(error)) {
      throw error;
    }
  }

  return resolveGlanceableConsumer({
    userId: opts.userId,
    key: opts.key,
    properties: opts.properties,
    isPreview: opts.isPreview,
    user,
    sharedEndpointCache: opts.sharedEndpointCache,
    sharedRuntimeCache: opts.sharedRuntimeCache,
  });
}

export type ConsumerDataForRequestResult = ReturnType<typeof resolveConsumerData>;

export async function resolveConsumerDataForRequest(opts: {
  userId: string;
  pb: any;
  type: "widget" | "glanceable";
  key: string;
  properties?: Record<string, any>;
  isPreview?: boolean;
  sharedRuntimeCache?: Map<string, any>;
  sharedEndpointCache?: Map<string, ResolvedEndpointData>;
}): ConsumerDataForRequestResult {
  return resolveConsumerData({
    userId: opts.userId,
    pb: opts.pb,
    type: opts.type,
    key: opts.key,
    properties: isPlainObject(opts.properties) ? opts.properties : {},
    isPreview: Boolean(opts.isPreview),
    sharedEndpointCache: opts.sharedEndpointCache,
    sharedRuntimeCache: opts.sharedRuntimeCache,
  });
}

async function resolveWidgetConsumer(opts: {
  userId: string;
  key: string;
  properties: Record<string, any>;
  isPreview: boolean;
  user: Record<string, any> | null;
  sharedRuntimeCache?: Map<string, any>;
  sharedEndpointCache?: Map<string, ResolvedEndpointData>;
}) {
  const payload = await getIntegrationWithConsumer(opts.userId, { widgetKey: opts.key });
  if (!payload?.integrationId || !payload?.integration || !payload?.widgetJSON) {
    throw new ApiActionError("Widget integration not found", 404, {
      error: "Widget integration not found",
    });
  }

  const cacheConfig = resolveIntegrationCacheConfig(payload.integration);
  const integrationConfig = payload.integration as Record<string, any>;
  const envWithStatefulHiddenVars = resolveStatefulEnvironmentVariables({
    envValues: toEnvValueMap(integrationConfig?.configuration?.environment_variables),
    envDefinitions: payload?.environmentDefinitions,
    localData: payload.localData,
    retentionSeconds: cacheConfig.retentionSeconds,
  });

  const resolvedIntegrationEnv = resolveUserInjectedEnv(envWithStatefulHiddenVars.values, opts.user);
  const integrationJSON = applyIntegrationEnv(payload.integration, resolvedIntegrationEnv);
  const mergedInput = mergeWidgetInput(resolvedIntegrationEnv, opts.properties);
  const widgetJSON = applyWidgetInput(payload.widgetJSON, mergedInput ?? {});

  const cacheContext = createIntegrationCacheContext({
    localData: envWithStatefulHiddenVars.localData,
    type: "widget",
    key: opts.key,
    input: mergedInput ?? {},
    integrationJSON,
    cacheConfig,
    sharedEndpointCache: opts.sharedEndpointCache,
  });

  const runtimeCacheKey = createIntegrationRuntimeCacheKey(payload.integrationId, mergedInput ?? {});
  const sharedRuntime = runtimeCacheKey && opts.sharedRuntimeCache?.get(runtimeCacheKey);
  const cachedRuntime = cacheContext.getRuntimeSnapshot();
  let runtimeData = sharedRuntime ?? cachedRuntime;
  let freshRuntime: { data: Record<string, any> | null; env: Record<string, string> } | null = null;

  const shouldResolveFresh = !runtimeData || (!sharedRuntime && cacheConfig.policy === "cache-first");
  if (shouldResolveFresh) {
    freshRuntime = await resolveWidgetRuntimeData({
      widgetJSON,
      integrationJSON,
      data: null,
      isPreview: opts.isPreview,
      endpointCache: cacheContext.createEndpointCacheAdapter({
        readEnabled: !cachedRuntime,
      }),
      allowInsecureEndpoints: config.ALLOW_SSL,
    });
    cacheContext.setRuntimeSnapshot(freshRuntime);
    if (!runtimeData) {
      runtimeData = freshRuntime;
    }
  }

  if (!runtimeData) {
    runtimeData = await resolveWidgetRuntimeData({
      widgetJSON,
      integrationJSON,
      data: null,
      isPreview: opts.isPreview,
      endpointCache: cacheContext.createEndpointCacheAdapter({ readEnabled: true }),
      allowInsecureEndpoints: config.ALLOW_SSL,
    });
    cacheContext.setRuntimeSnapshot(runtimeData);
  }

  if (runtimeCacheKey && opts.sharedRuntimeCache && !opts.sharedRuntimeCache.has(runtimeCacheKey)) {
    opts.sharedRuntimeCache.set(runtimeCacheKey, runtimeData);
  }

  if (runtimeData !== cachedRuntime) {
    cacheContext.setRuntimeSnapshot(runtimeData);
  }

  await persistLocalDataIfChanged(payload.integrationId, cacheContext);

  const staleServed = cacheConfig.policy === "cache-first" && Boolean(cachedRuntime && freshRuntime);
  const blueprint = {
    template: widgetJSON.template ?? "columns",
    resolved: resolveWidgetProperties({
      widgetJSON,
      integrationJSON,
      data: runtimeData.data,
      isPreview: opts.isPreview,
    }),
    widgetJSON,
  };

  const freshBlueprint = staleServed && freshRuntime
    ? {
      template: widgetJSON.template ?? "columns",
      resolved: resolveWidgetProperties({
        widgetJSON,
        integrationJSON,
        data: freshRuntime.data,
        isPreview: opts.isPreview,
      }),
      widgetJSON,
    }
    : null;

  return {
    consumer: "widget" as const,
    key: opts.key,
    integrationId: payload.integrationId,
    input: mergedInput,
    env: runtimeData.env,
    data: runtimeData.data,
    blueprint,
    fresh: staleServed && freshRuntime
      ? {
        env: freshRuntime.env,
        data: freshRuntime.data,
        blueprint: freshBlueprint,
      }
      : null,
    cache: {
      policy: cacheConfig.policy,
      retentionSeconds: cacheConfig.retentionSeconds,
      stateKey: cacheContext.stateKey,
      fromCache: Boolean(cachedRuntime),
      staleReturned: staleServed,
    },
  };
}

async function resolveGlanceableConsumer(opts: {
  userId: string;
  key: string;
  properties: Record<string, any>;
  isPreview: boolean;
  user: Record<string, any> | null;
  sharedRuntimeCache?: Map<string, any>;
  sharedEndpointCache?: Map<string, ResolvedEndpointData>;
}) {
  let payload = await getIntegrationWithConsumer(opts.userId, { glanceableType: opts.key });
  if ((!payload?.integrationId || !payload?.integration || !payload?.glanceableJSON) && !opts.key.startsWith("local-")) {
    payload = await getIntegrationWithConsumer(opts.userId, { glanceableType: `local-${opts.key}` });
  }
  if (!payload?.integrationId || !payload?.integration || !payload?.glanceableJSON) {
    throw new ApiActionError("Glanceable integration not found", 404, {
      error: "Glanceable integration not found",
    });
  }

  const cacheConfig = resolveIntegrationCacheConfig(payload.integration);
  const integrationConfig = payload.integration as Record<string, any>;
  const envWithStatefulHiddenVars = resolveStatefulEnvironmentVariables({
    envValues: toEnvValueMap(integrationConfig?.configuration?.environment_variables),
    envDefinitions: payload?.environmentDefinitions,
    localData: payload.localData,
    retentionSeconds: cacheConfig.retentionSeconds,
  });

  const resolvedIntegrationEnv = resolveUserInjectedEnv(envWithStatefulHiddenVars.values, opts.user);
  const integrationJSON = applyIntegrationEnv(payload.integration, resolvedIntegrationEnv);
  const mergedInput = mergeGlanceableInput(resolvedIntegrationEnv, opts.properties);
  const glanceableJSON = mergeGlanceableJSON(payload.glanceableJSON, opts.properties);

  const cacheContext = createIntegrationCacheContext({
    localData: envWithStatefulHiddenVars.localData,
    type: "glanceable",
    key: opts.key,
    input: mergedInput,
    integrationJSON,
    cacheConfig,
    sharedEndpointCache: opts.sharedEndpointCache,
  });

  const runtimeCacheKey = createIntegrationRuntimeCacheKey(payload.integrationId, mergedInput);
  const sharedRuntime = runtimeCacheKey && opts.sharedRuntimeCache?.get(runtimeCacheKey);
  const cachedRuntime = cacheContext.getRuntimeSnapshot();
  let runtimeData = sharedRuntime ?? cachedRuntime;
  let freshRuntime: { data: Record<string, any> | null; env: Record<string, string> } | null = null;

  const shouldResolveFresh = !runtimeData || (!sharedRuntime && cacheConfig.policy === "cache-first");
  if (shouldResolveFresh) {
    freshRuntime = await resolveGlanceableRuntimeData({
      glanceableJSON,
      integrationJSON,
      data: null,
      isPreview: opts.isPreview,
      baseEnv: normalizeInputEnv(mergedInput),
      endpointCache: cacheContext.createEndpointCacheAdapter({
        readEnabled: !cachedRuntime,
      }),
    });
    cacheContext.setRuntimeSnapshot(freshRuntime);
    if (!runtimeData) {
      runtimeData = freshRuntime;
    }
  }

  if (!runtimeData) {
    runtimeData = await resolveGlanceableRuntimeData({
      glanceableJSON,
      integrationJSON,
      data: null,
      isPreview: opts.isPreview,
      baseEnv: normalizeInputEnv(mergedInput),
      endpointCache: cacheContext.createEndpointCacheAdapter({ readEnabled: true }),
    });
    cacheContext.setRuntimeSnapshot(runtimeData);
  }

  if (runtimeCacheKey && opts.sharedRuntimeCache && !opts.sharedRuntimeCache.has(runtimeCacheKey)) {
    opts.sharedRuntimeCache.set(runtimeCacheKey, runtimeData);
  }

  if (runtimeData !== cachedRuntime) {
    cacheContext.setRuntimeSnapshot(runtimeData);
  }

  await persistLocalDataIfChanged(payload.integrationId, cacheContext);

  const rawText = typeof glanceableJSON.text === "string"
    ? glanceableJSON.text
    : (typeof glanceableJSON.name === "string" ? glanceableJSON.name : "");
  const staleServed = cacheConfig.policy === "cache-first" && Boolean(cachedRuntime && freshRuntime);

  const blueprint = {
    text: rawText ? resolveGlanceableText(rawText, runtimeData.env) : "",
    icon: getGlanceableIconSource(glanceableJSON.icon, runtimeData.env),
    glanceableJSON,
  };

  const freshBlueprint = staleServed && freshRuntime
    ? {
      text: rawText ? resolveGlanceableText(rawText, freshRuntime.env) : "",
      icon: getGlanceableIconSource(glanceableJSON.icon, freshRuntime.env),
      glanceableJSON,
    }
    : null;

  return {
    consumer: "glanceable" as const,
    key: opts.key,
    integrationId: payload.integrationId,
    input: mergedInput,
    env: runtimeData.env,
    data: runtimeData.data,
    blueprint,
    fresh: staleServed && freshRuntime
      ? {
        env: freshRuntime.env,
        data: freshRuntime.data,
        blueprint: freshBlueprint,
      }
      : null,
    cache: {
      policy: cacheConfig.policy,
      retentionSeconds: cacheConfig.retentionSeconds,
      stateKey: cacheContext.stateKey,
      fromCache: Boolean(cachedRuntime),
      staleReturned: staleServed,
    },
  };
}

function createIntegrationRuntimeCacheKey(
  integrationId: string,
  mergedInput: Record<string, any>,
) {
  return `${integrationId}:${stableStringifyAny(mergedInput)}`;
}

function stableStringifyAny(value: unknown) {
  return JSON.stringify(sortObject(value));
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortObject(entry));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const result: Record<string, unknown> = {};
  Object.keys(value)
    .sort()
    .forEach((key) => {
      result[key] = sortObject((value as Record<string, unknown>)[key]);
    });
  return result;
}

function parseConsumerType(typeRaw: string | null): ConsumerType | null {
  const normalized = String(typeRaw ?? "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized === "widget" || normalized === "glanceable") {
    return normalized;
  }

  throw new ApiActionError("Invalid type", 400, {
    error: "Invalid type. Expected widget or glanceable",
  });
}

function parsePropertiesBody(raw: unknown): Record<string, any> {
  if (!isPlainObject(raw)) {
    return {};
  }
  return raw as Record<string, any>;
}

function applyWidgetInput(
  widgetJSON: Record<string, any>,
  input: Record<string, any>,
) {
  if (!isPlainObject(input) || Object.keys(input).length === 0) {
    return widgetJSON;
  }

  return {
    ...widgetJSON,
    data: {
      ...(widgetJSON?.data ?? {}),
      input: {
        ...((widgetJSON?.data?.input ?? {}) as Record<string, any>),
        ...input,
      },
    },
  };
}

function applyIntegrationEnv(
  integrationJSON: Record<string, any>,
  environmentVariables: Record<string, any> | null | undefined,
) {
  return {
    ...integrationJSON,
    configuration: {
      ...(integrationJSON?.configuration ?? {}),
      environment_variables: environmentVariables ?? {},
    },
  };
}

function mergeWidgetInput(
  resolvedInput: Record<string, any> | null | undefined,
  properties: Record<string, any>,
) {
  const instanceInput =
    isPlainObject(properties?.input)
      ? (properties.input as Record<string, any>)
      : null;

  if (!resolvedInput && !instanceInput) {
    return null;
  }

  return {
    ...(resolvedInput ?? {}),
    ...(instanceInput ?? {}),
  };
}

function mergeGlanceableInput(
  resolvedInput: Record<string, any> | null | undefined,
  properties: Record<string, any>,
) {
  const instanceInput =
    isPlainObject(properties?.input)
      ? (properties.input as Record<string, any>)
      : isPlainObject(properties)
      ? properties
      : null;

  return {
    ...(resolvedInput ?? {}),
    ...(instanceInput ?? {}),
  };
}

function mergeGlanceableJSON(
  glanceableJSON: Record<string, any>,
  properties: Record<string, any>,
) {
  if (!isPlainObject(properties)) {
    return glanceableJSON;
  }

  return {
    ...glanceableJSON,
    properties: {
      ...(glanceableJSON.properties ?? {}),
      ...properties,
    },
  };
}

async function getAuthUserRecord(pb: any, userId: string) {
  try {
    const userRecord = await pb.collection("users").getOne(userId);
    return isPlainObject(userRecord) ? (userRecord as Record<string, any>) : null;
  } catch {
    return null;
  }
}

function isApiNotFound(error: unknown) {
  return error instanceof ApiActionError && error.status === 404;
}

function resolveUserInjectedEnv(envVars: any, user: Record<string, any> | null): any {
  if (envVars == null) return envVars;

  const resolveString = (str: string) => {
    if (typeof str !== "string" || str.indexOf("${") === -1) return str;
    return str.replace(/\$\{([^}]+)\}/g, (_m, expr: string) => {
      const trimmed = expr.trim();
      if (!trimmed.startsWith("user.")) return "";
      const path = trimmed.slice(5).split(".");
      let val: any = user;
      for (const seg of path) {
        if (val == null) return "";
        val = val[seg];
      }
      if (val == null) return "";
      if (typeof val === "object") return JSON.stringify(val);
      return String(val);
    });
  };

  if (typeof envVars === "string") return resolveString(envVars);
  if (Array.isArray(envVars)) return envVars.map((v) => resolveUserInjectedEnv(v, user));
  if (typeof envVars === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(envVars)) {
      out[k] = resolveUserInjectedEnv(v, user);
    }
    return out;
  }

  return envVars;
}

function getGlanceableIconSource(icon: unknown, env: Record<string, string>) {
  if (!icon || icon === "none") return null;
  if (typeof icon === "string") return resolveTemplatedString(icon, env);

  if (typeof icon === "object") {
    const iconRecord = icon as Record<string, any>;
    const source =
      iconRecord.source ??
      iconRecord.file ??
      iconRecord.icon ??
      iconRecord.value;

    if (typeof source === "string" && source.trim()) {
      return resolveTemplatedString(source.trim(), env);
    }
  }

  return null;
}

function resolveTemplatedString(value: string, env: Record<string, string>) {
  const segments = value.split("???");

  for (const segment of segments) {
    const resolved = interpolateString(segment.trim(), env).trim();
    if (resolved) {
      return resolved;
    }
  }

  return segments[segments.length - 1].trim();
}

function resolveGlanceableText(template: string, env: Record<string, string>) {
  const withLibDate = template.replace(/\$\{lib\.date\.time\(([^}]+)\)\}/g, (_match: string, rawTimezone: string) => {
    const timezone = normalizeTimezone(interpolateString(String(rawTimezone).trim(), env));
    return timezone ? formatTime(new Date(), { timeZone: timezone }) : formatTime(new Date());
  });

  return resolveStringWithCasts(withLibDate, env);
}

function normalizeTimezone(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;

  const parsed = String(raw).trim();
  if (!parsed) return undefined;

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: parsed });
    return parsed;
  } catch {
    return undefined;
  }
}

function formatTime(input?: Date | string | number, opts?: Intl.DateTimeFormatOptions) {
  const date = toDate(input);
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    ...opts,
  }).format(date);
}

function toDate(input?: Date | string | number): Date {
  if (!input) return new Date();
  return input instanceof Date ? input : new Date(input);
}

function normalizeInputEnv(input: Record<string, any>) {
  return flattenToEnv(isPlainObject(input) ? input : {});
}

function buildConsumerStateVars(
  integrationJSON: Record<string, any>,
  input: Record<string, any>,
) {
  const rawEnv = isPlainObject(integrationJSON?.configuration?.environment_variables)
    ? flattenToEnv(integrationJSON.configuration.environment_variables as Record<string, any>)
    : {};
  const inputEnv = normalizeInputEnv(input);
  const produced = getEndpointProducedVars(integrationJSON);
  const merged = { ...rawEnv, ...inputEnv };

  for (const variableName of produced) {
    delete merged[variableName];
  }

  return merged;
}

function getEndpointProducedVars(integrationJSON: Record<string, any>) {
  const result = new Set<string>();
  const endpoints = integrationJSON?.configuration?.endpoints;
  if (!isPlainObject(endpoints)) {
    return result;
  }

  for (const endpointValue of Object.values(endpoints)) {
    if (!isPlainObject(endpointValue)) continue;
    const response = isPlainObject(endpointValue.response)
      ? endpointValue.response
      : null;
    const envVar = typeof response?.data_set_env === "string"
      ? response.data_set_env.trim()
      : "";
    if (envVar) {
      result.add(envVar);
    }
  }

  return result;
}

function stableStringify(value: Record<string, string>) {
  const sorted = Object.keys(value)
    .sort()
    .reduce<Record<string, string>>((acc, key) => {
      acc[key] = value[key];
      return acc;
    }, {});
  return JSON.stringify(sorted);
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function getOrCreateObject(parent: Record<string, any>, key: string) {
  const current = parent[key];
  if (isPlainObject(current)) {
    return current as Record<string, any>;
  }
  const next: Record<string, any> = {};
  parent[key] = next;
  return next;
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveIntegrationCacheConfig(integrationJSON: Record<string, any>): IntegrationCacheConfig {
  const rawCache = isPlainObject(integrationJSON?.configuration?.cache)
    ? (integrationJSON.configuration.cache as Record<string, any>)
    : null;
  const rawPolicy = String(rawCache?.policy ?? "").trim().toLowerCase();
  const policy: CachePolicy = rawPolicy === "cache-first" ? "cache-first" : "strict";

  const rawRetention = Number(rawCache?.retention);
  const retentionSeconds = Number.isFinite(rawRetention) && rawRetention > 0
    ? rawRetention
    : 300;

  return { policy, retentionSeconds };
}

function toEnvValueMap(raw: unknown): Record<string, any> {
  if (!isPlainObject(raw)) {
    return {};
  }

  return Object.entries(raw as Record<string, unknown>).reduce<Record<string, any>>((acc, [key, value]) => {
    acc[key] = value;
    return acc;
  }, {});
}

function resolveStatefulEnvironmentVariables(opts: {
  envValues: Record<string, any>;
  envDefinitions: unknown;
  localData: unknown;
  retentionSeconds: number;
}) {
  const localData = isPlainObject(opts.localData)
    ? deepClone(opts.localData as Record<string, any>)
    : {};
  const hiddenEnvState = getOrCreateObject(localData, "statefulEnv");
  const values = { ...opts.envValues };
  const now = Date.now();
  let changed = false;

  if (isPlainObject(opts.envDefinitions)) {
    for (const [name, definitionRaw] of Object.entries(opts.envDefinitions as Record<string, unknown>)) {
      const definition = isPlainObject(definitionRaw)
        ? (definitionRaw as Record<string, any>)
        : null;
      if (!definition || definition.user_hidden !== true) {
        continue;
      }

      const stateRaw = hiddenEnvState[name];
      const state = isPlainObject(stateRaw)
        ? (stateRaw as Record<string, any>)
        : null;
      const currentValue = typeof values[name] === "string" ? values[name].trim() : "";
      const stateValue = typeof state?.value === "string" ? state.value.trim() : "";
      const invalidatesAt = Number(state?.invalidatesAt);
      const hasState = Number.isFinite(invalidatesAt);
      const stateStillValid = Number.isFinite(invalidatesAt) && invalidatesAt > now;

      let resolved = currentValue;
      if (!resolved && stateStillValid && stateValue) {
        resolved = stateValue;
        values[name] = stateValue;
        changed = true;
      }

      if (!resolved || (hasState && !stateStillValid)) {
        resolved = randomUUID().replace(/-/g, "");
        values[name] = resolved;
        hiddenEnvState[name] = {
          value: resolved,
          invalidatesAt: now + (opts.retentionSeconds * 1000),
        };
        changed = true;
        continue;
      }

      if (
        !state ||
        state.value !== resolved ||
        !hasState
      ) {
        hiddenEnvState[name] = {
          value: resolved,
          invalidatesAt: hasState && stateStillValid
            ? invalidatesAt
            : now + (opts.retentionSeconds * 1000),
        };
        changed = true;
      }
    }
  }

  return {
    values,
    localData,
    changed,
  };
}

function encodeStateKey(state: Record<string, string>) {
  return Buffer.from(stableStringify(state), "utf-8").toString("base64");
}

function createIntegrationCacheContext(opts: {
  localData: unknown;
  type: ConsumerType;
  key: string;
  input: Record<string, any>;
  integrationJSON: Record<string, any>;
  cacheConfig: IntegrationCacheConfig;
  sharedEndpointCache?: Map<string, ResolvedEndpointData>;
}) {
  const root = isPlainObject(opts.localData)
    ? deepClone(opts.localData as Record<string, any>)
    : {};
  const cacheKV = getOrCreateObject(root, "cacheKV");
  const statefulVars = buildConsumerStateVars(opts.integrationJSON, opts.input);
  const stateKey = encodeStateKey(statefulVars);
  const cacheNamespace = `${opts.type}:${opts.key}:${stateKey}`;
  const runtimeSnapshotKey = `${cacheNamespace}:runtime`;

  let changed = false;

  const readRecord = (key: string): CacheRecord | null => {
    const recordRaw = cacheKV[key];
    if (!isPlainObject(recordRaw)) {
      return null;
    }

    const record = recordRaw as CacheRecord;
    const invalidatesAt = Number(record.invalidatesAt);
    if (Number.isFinite(invalidatesAt) && invalidatesAt <= Date.now()) {
      delete cacheKV[key];
      changed = true;
      return null;
    }

    return record;
  };

  const writeRecord = (
    key: string,
    value: unknown,
    invalidatesAt: number | null,
    retentionSeconds: number | null,
  ) => {
    cacheKV[key] = {
      value,
      retentionSeconds,
      invalidatesAt,
      createdAt: Date.now(),
    } satisfies CacheRecord;
    changed = true;
  };

  const createEndpointKey = (endpointId: string) => `${cacheNamespace}:endpoint:${endpointId}`;

  const createEndpointCacheAdapter = (
    options?: { readEnabled?: boolean },
  ): EndpointRuntimeCacheAdapter => {
    const readEnabled = options?.readEnabled ?? true;
    return {
      get(endpointId: string): ResolvedEndpointData | null {
        if (!readEnabled) {
          return null;
        }

        const shared = opts.sharedEndpointCache?.get(createEndpointKey(endpointId));
        if (shared) {
          return shared;
        }

        const record = readRecord(createEndpointKey(endpointId));
        if (!record || !isPlainObject(record.value)) {
          return null;
        }

        return record.value as ResolvedEndpointData;
      },
      set(endpointId: string, payload: ResolvedEndpointData, expiresAt: number | null): void {
        const expires = Number(expiresAt);
        if (!Number.isFinite(expires) || expires <= Date.now()) {
          return;
        }

        opts.sharedEndpointCache?.set(createEndpointKey(endpointId), payload);

        const ttlSeconds = Math.max(1, Math.floor((expires - Date.now()) / 1000));
        writeRecord(createEndpointKey(endpointId), payload, expires, ttlSeconds);
      },
    };
  };

  const getRuntimeSnapshot = () => {
    const record = readRecord(runtimeSnapshotKey);
    if (!record || !isPlainObject(record.value)) {
      return null;
    }

    const value = record.value as Record<string, unknown>;
    const env = isPlainObject(value.env)
      ? (value.env as Record<string, string>)
      : null;

    if (!env) {
      return null;
    }

    return {
      env,
      data: isPlainObject(value.data) ? (value.data as Record<string, any>) : null,
    };
  };

  const setRuntimeSnapshot = (runtime: { data: Record<string, any> | null; env: Record<string, string> }) => {
    writeRecord(
      runtimeSnapshotKey,
      {
        data: runtime.data,
        env: runtime.env,
      },
      Date.now() + (opts.cacheConfig.retentionSeconds * 1000),
      opts.cacheConfig.retentionSeconds,
    );
  };

  return {
    stateKey,
    createEndpointCacheAdapter,
    getRuntimeSnapshot,
    setRuntimeSnapshot,
    get changed() {
      return changed;
    },
    localData: root,
  };
}

async function persistLocalDataIfChanged(
  integrationId: string,
  cacheContext: {
    changed: boolean;
    localData: Record<string, any>;
  },
) {
  if (!cacheContext.changed) {
    return;
  }

  const pb = await getSuperuserPB();
  await pb.collection("integrations").update(integrationId, {
    localData: cacheContext.localData,
  });
}
