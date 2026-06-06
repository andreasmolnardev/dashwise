import { Hono } from "hono";
import { randomUUID } from "crypto";

import {
  createIntegration,
  deleteIntegration,
  getIntegration,
  getIntegrationWithConsumer,
  getWidgetProperties,
  listIntegrations,
  testIntegrationEndpoint,
  updateIntegration,
} from "../lib/data/integrations";
import { ApiActionError } from "../lib/data/auth";
import { getSuperuserPB } from "../lib/pb/pocketbase";
import {
  flattenToEnv,
  interpolateString,
  resolveGlanceableRuntimeData,
  resolveStringWithCasts,
  resolveWidgetProperties,
  resolveWidgetRuntimeData,
} from "@dashwise/integrationskit/data/resolveProperties";
import { evaluateCondition } from "@dashwise/integrationskit/data/resolveProperties";
import type {
  EndpointRuntimeCacheAdapter,
  ResolvedEndpointData,
} from "@dashwise/integrationskit/data/getEndpointData";

import {
  readAuthToken,
  readBool,
  readJsonBody,
  requireAuth,
  withJson,
} from "./shared";
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

integrationsRoute
  .get(
    "/api/v1/integrations",
    withJson(async (c) => {
      const { userId } = await requireAuth({ token: readAuthToken(c) });
      const id = c.req.query("id") ?? undefined;
      const resolveEndpoints = readBool(
        c.req.query("resolveEndpoints") ?? undefined,
      );
      return id
        ? getIntegration(userId, id, resolveEndpoints)
        : listIntegrations(userId);
    }),
  )
  .post(
    "/api/v1/integrations",
    withJson(async (c) => {
      const body = await readJsonBody<any>(c);
      const { userId } = await requireAuth({ token: readAuthToken(c) });
      return createIntegration(userId, body ?? {});
    }),
  )
  .put(
    "/api/v1/integrations/:id",
    withJson(async (c) => {
      const id = c.req.param("id")!;
      const body = await readJsonBody<any>(c);
      const { userId } = await requireAuth({ token: readAuthToken(c) });
      return updateIntegration(userId, id, body ?? {});
    }),
  )
  .delete(
    "/api/v1/integrations/:id",
    withJson(async (c) => {
      const id = c.req.param("id")!;
      const { userId } = await requireAuth({ token: readAuthToken(c) });
      return deleteIntegration(userId, id);
    }),
  )
  .post(
    "/api/v1/integrations/test-endpoint",
    withJson(async (c) => {
      const body = await readJsonBody<any>(c);
      const { userId } = await requireAuth({ token: readAuthToken(c) });
      return testIntegrationEndpoint(userId, String(body?.target ?? ""));
    }),
  )
  .post(
    "/api/v1/integrations/proxyAction",
    withJson(async (c) => {
      const body = await readJsonBody<any>(c);
      const { userId } = await requireAuth({ token: readAuthToken(c) });
      const searchItemId = String(body?.searchItemId ?? body?.id ?? "").trim();

      if (!searchItemId) {
        throw new ApiActionError("Missing searchItemId", 400, {
          error: "Missing searchItemId",
        });
      }

      const pb = await getSuperuserPB();
      const record = await pb.collection("searchItems").getOne(searchItemId);
      if (!record || record.user !== userId) {
        throw new ApiActionError("Unauthorized", 403, { error: "Unauthorized" });
      }

      const action = parseProxyAction(record.action);
      if (!action?.url) {
        throw new ApiActionError("Unsupported proxy action", 400, {
          error: "Unsupported proxy action",
        });
      }

      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(action.headers ?? {})) {
        headers[key] = String(value ?? "");
      }

      const hasAuthHeader = Object.keys(headers).some((k) =>
        k.toLowerCase() === "authorization"
      );
      if (action.auth && !hasAuthHeader) {
        headers.Authorization = action.auth;
      }

      let requestBody: string | undefined;
      if (action.body != null) {
        requestBody = typeof action.body === "string"
          ? action.body
          : JSON.stringify(action.body);
        if (
          !Object.keys(headers).some((k) => k.toLowerCase() === "content-type")
        ) {
          headers["content-type"] = "application/json";
        }
      }

      const response = await fetch(action.url, {
        method: "POST",
        headers,
        body: requestBody,
        ...(config.ALLOW_SSL
          ? ({ tls: { rejectUnauthorized: false } } as any)
          : {}),
      } as any);

      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        body: await response.text(),
      };
    }),
  )
  .get(
    "/api/v1/integrations/widget-properties",
    withJson(async (c) => {
      const { userId } = await requireAuth({ token: readAuthToken(c) });
      return getWidgetProperties(
        userId,
        String(c.req.query("widgetSlug") ?? ""),
      );
    }),
  )
  .get(
    "/api/v1/integrations/consumerData",
    withJson(async (c) => {
      const auth = await requireAuth({ token: readAuthToken(c) });
      const typeRaw = String(c.req.query("type") ?? "").trim().toLowerCase();
      const key = String(c.req.query("key") ?? "").trim();
      const properties = parseInputQuery(c.req.query("input") ?? null);

      if (!key) {
        throw new ApiActionError("Missing key", 400, { error: "Missing key" });
      }

      try {
        return omitConsumerDataMeta(
          await resolveConsumerData({
            userId: auth.userId,
            pb: auth.pb,
            type: parseConsumerType(typeRaw || null),
            key,
            properties,
            environmentOverrides: {},
            isPreview: false,
          }),
        );
      } catch (e) {
        console.error("[integrations/consumerData] GET Error:", e);
        throw e;
      }
    }),
  )
  .post(
    "/api/v1/integrations/consumerData",
    withJson(async (c) => {
      const auth = await requireAuth({ token: readAuthToken(c) });
      const body = await readJsonBody<any>(c);
      const key = String(body?.key ?? "").trim();
      const isPreview = Boolean(body?.isPreview);
      const properties = parsePropertiesBody(body?.properties);
      const environmentOverrides = parseEnvironmentOverridesBody(
        body?.environmentOverrides,
      );

      if (!key) {
        throw new ApiActionError("Missing key", 400, { error: "Missing key" });
      }

      try {
        return omitConsumerDataMeta(
          await resolveConsumerData({
            userId: auth.userId,
            pb: auth.pb,
            type: parseConsumerType(
              typeof body?.type === "string" ? body.type : null,
            ),
            key,
            properties,
            environmentOverrides,
            isPreview,
          }),
        );
      } catch (e) {
        console.error("[integrations/consumerData] POST Error:", e);
        throw e;
      }
    }),
  )
  .get(
    "/api/v1/integrations/caldav/events",
    withJson(async (c) => {
      const { userId, pb } = await requireAuth({ token: readAuthToken(c) });
      const integrationId = c.req.query("integrationId") ?? undefined;

      const updateLocalData = (
        id: string,
        localData: Record<string, unknown>,
      ) => pb.collection("integrations").update(id, { localData });

      if (integrationId) {
        const integration = await getIntegration(userId, integrationId);
        if (!integration) {
          throw new ApiActionError("Integration not found", 404, {
            error: "Not found",
          });
        }
        const events = await getUpcomingEvents(
          (integration as any).environment,
          (integration as any).localData,
          (ld) => updateLocalData(integrationId, ld).then(() => undefined),
        );
        return { events };
      }

      const { integrations } = await listIntegrations(userId);
      const caldavIntegrations = integrations.filter(
        (i) => i.type === "caldav",
      );

      if (caldavIntegrations.length === 0) return { events: [] };

      const allEvents = await Promise.all(
        caldavIntegrations.map((integration) =>
          getUpcomingEvents(
            integration.environment,
            integration.localData,
            (ld) => updateLocalData(integration.id, ld).then(() => undefined),
          )
        ),
      );

      return { events: allEvents.flat() };
    }),
  );

export default integrationsRoute;

// --- Types ---

type ResolveConsumerDataOpts = {
  userId: string;
  pb: any;
  type: ConsumerType | null;
  key: string;
  properties: Record<string, any>;
  environmentOverrides: Record<string, string>;
  isPreview: boolean;
  sharedRuntimeCache?: Map<string, any>;
  sharedEndpointCache?: Map<string, ResolvedEndpointData>;
};

// --- Core resolver ---

async function resolveConsumerData(
  opts: ResolveConsumerDataOpts,
): Promise<any> {
  const user = await getAuthUserRecord(opts.pb, opts.userId);
  const resolverOpts = { ...opts, user };

  if (opts.type === "widget") return resolveWidgetConsumer(resolverOpts);
  if (opts.type === "glanceable") return resolveGlanceableConsumer(resolverOpts);
  

  try {
    return await resolveWidgetConsumer(resolverOpts);
  } catch (e) {
    if (!isApiNotFound(e)) throw e;
  }
  return resolveGlanceableConsumer(resolverOpts);
}

export type ConsumerDataForRequestResult = ReturnType<
  typeof resolveConsumerData
>;

export async function resolveConsumerDataForRequest(opts: {
  userId: string;
  pb: any;
  type: "widget" | "glanceable";
  key: string;
  properties?: Record<string, any>;
  environmentOverrides?: Record<string, string>;
  isPreview?: boolean;
  sharedRuntimeCache?: Map<string, any>;
  sharedEndpointCache?: Map<string, ResolvedEndpointData>;
}): ConsumerDataForRequestResult {
  return resolveConsumerData({
    userId: opts.userId,
    pb: opts.pb,
    type: opts.type,
    key: opts.key,
    properties: isPlainObject(opts.properties) ? opts.properties! : {},
    environmentOverrides: parseEnvironmentOverridesBody(
      opts.environmentOverrides,
    ),
    isPreview: Boolean(opts.isPreview),
    sharedEndpointCache: opts.sharedEndpointCache,
    sharedRuntimeCache: opts.sharedRuntimeCache,
  });
}

function prepareIntegrationEnv(
  integrationConfig: Record<string, any>,
  payload: {
    environmentDefinitions?: unknown;
    localData?: unknown;
    integration: Record<string, any>;
  },
  opts: {
    user: Record<string, any> | null;
    environmentOverrides: Record<string, string>;
  },
) {
  const cacheConfig = resolveIntegrationCacheConfig(payload.integration);
  const endpointProducedVars = getEndpointProducedVars(integrationConfig);
  const envWithStatefulHiddenVars = resolveStatefulEnvironmentVariables({
    envValues:
      isPlainObject(integrationConfig?.configuration?.environment_variables)
        ? integrationConfig.configuration.environment_variables
        : {},
    envDefinitions: payload.environmentDefinitions,
    endpointProducedVars,
    localData: payload.localData,
    retentionSeconds: cacheConfig.retentionSeconds,
  });

  const resolvedEnv = mergeEnvironmentOverrides(
    resolveUserInjectedEnv(envWithStatefulHiddenVars.values, opts.user),
    opts.environmentOverrides,
  );

  return { cacheConfig, envWithStatefulHiddenVars, resolvedEnv };
}

async function resolveWidgetConsumer(
  opts: ResolveConsumerDataOpts & { user: Record<string, any> | null },
) {
  const payload = await getIntegrationWithConsumer(opts.userId, {
    widgetKey: opts.key,
  });
  if (
    !payload?.integrationId || !payload?.integration || !payload?.widgetJSON
  ) {
    throw new ApiActionError("Widget integration not found", 404, {
      error: "Widget integration not found",
    });
  }

  const integrationConfig = payload.integration as Record<string, any>;
  const { cacheConfig, envWithStatefulHiddenVars, resolvedEnv } =
    prepareIntegrationEnv(
      integrationConfig,
      payload,
      opts,
    );

  const integrationJSON = applyIntegrationEnv(payload.integration, resolvedEnv);
  const mergedInput = mergeWidgetInput(resolvedEnv, opts.properties);
  const widgetJSON = applyWidgetInput(payload.widgetJSON, mergedInput ?? {});

  const cacheContext = createIntegrationCacheContext({
    localData: envWithStatefulHiddenVars.localData,
    type: "widget",
    key: opts.key,
    input: mergedInput ?? {},
    integrationJSON,
    cacheConfig,
    initialChanged: envWithStatefulHiddenVars.changed,
    sharedEndpointCache: opts.sharedEndpointCache,
  });

  const runtimeData = await resolveFreshRuntime(
    () =>
      resolveWidgetRuntimeData({
        widgetJSON,
        integrationJSON,
        data: null,
        isPreview: opts.isPreview,
        endpointCache: cacheContext.createEndpointCacheAdapter({
          readEnabled: true,
        }),
        allowInsecureEndpoints: config.ALLOW_SSL,
      }),
    { cacheContext, isPreview: opts.isPreview, cacheConfig },
  );

  if (!runtimeData) {
    throw new ApiActionError("Unable to resolve widget runtime data", 500, {
      error: "Unable to resolve widget runtime data",
    });
  }

  const { _fromCache, _stale, ...runtime } = runtimeData;

  await persistLocalDataIfChanged(payload.integrationId, cacheContext);

  return {
    consumer: "widget" as const,
    key: opts.key,
    integrationId: payload.integrationId,
    input: mergedInput,
    env: runtime.env,
    data: runtime.data,
    blueprint: {
      template: widgetJSON.template ?? "columns",
      resolved: resolveWidgetProperties({
        widgetJSON,
        integrationJSON,
        data: runtime.data,
        isPreview: opts.isPreview,
      }),
      widgetJSON,
    },
    fresh: null,
    cache: buildCacheMeta(cacheConfig, cacheContext, _fromCache, _stale),
  };
}

async function resolveGlanceableConsumer(
  opts: ResolveConsumerDataOpts & { user: Record<string, any> | null },
) {
  let payload = await getIntegrationWithConsumer(opts.userId, {
    glanceableType: opts.key,
  });
  if (
    (!payload?.integrationId || !payload?.integration ||
      !payload?.glanceableJSON) && !opts.key.startsWith("local-")
  ) {
    payload = await getIntegrationWithConsumer(opts.userId, {
      glanceableType: `local-${opts.key}`,
    });
  }
  if (
    !payload?.integrationId || !payload?.integration || !payload?.glanceableJSON
  ) {
    throw new ApiActionError("Glanceable integration not found", 404, {
      error: "Glanceable integration not found",
    });
  }

  const integrationConfig = payload.integration as Record<string, any>;
  const { cacheConfig, envWithStatefulHiddenVars, resolvedEnv } =
    prepareIntegrationEnv(
      integrationConfig,
      payload,
      opts,
    );

  const integrationJSON = applyIntegrationEnv(payload.integration, resolvedEnv);
  const mergedInput = mergeGlanceableInput(resolvedEnv, opts.properties);
  const glanceableJSON = mergeGlanceableJSON(
    payload.glanceableJSON,
    opts.properties,
  );

  const cacheContext = createIntegrationCacheContext({
    localData: envWithStatefulHiddenVars.localData,
    type: "glanceable",
    key: opts.key,
    input: mergedInput,
    integrationJSON,
    cacheConfig,
    initialChanged: envWithStatefulHiddenVars.changed,
    sharedEndpointCache: opts.sharedEndpointCache,
  });

  const runtimeData = await resolveFreshRuntime(
    () =>
      resolveGlanceableRuntimeData({
        glanceableJSON,
        integrationJSON,
        data: null,
        isPreview: opts.isPreview,
        baseEnv: flattenToEnv(isPlainObject(mergedInput) ? mergedInput : {}),
        endpointCache: cacheContext.createEndpointCacheAdapter({
          readEnabled: true,
        }),
      }),
    { cacheContext, isPreview: opts.isPreview, cacheConfig },
  );

  if (!runtimeData) {
    throw new ApiActionError("Unable to resolve glanceable runtime data", 500, {
      error: "Unable to resolve glanceable runtime data",
    });
  }

  const { _fromCache, _stale, ...runtime } = runtimeData;

  await persistLocalDataIfChanged(payload.integrationId, cacheContext);
  const resolvedText = resolveGlanceableTextValue(
    glanceableJSON.text,
    runtime.env,
    typeof glanceableJSON.name === "string" ? glanceableJSON.name : "",
  );

  return {
    consumer: "glanceable" as const,
    key: opts.key,
    integrationId: payload.integrationId,
    input: mergedInput,
    env: runtime.env,
    data: runtime.data,
    blueprint: {
      text: resolvedText,
      icon: getGlanceableIconSource(glanceableJSON.icon, runtime.env),
      glanceableJSON,
    },
    fresh: null,
    cache: buildCacheMeta(cacheConfig, cacheContext, _fromCache, _stale),
  };
}

// Always resolves fresh; caches the result unless in preview mode.
async function resolveFreshRuntime(
  resolve: () => Promise<
    { data: Record<string, any> | null; env: Record<string, string> }
  >,
  ctx: {
    cacheContext: ReturnType<typeof createIntegrationCacheContext>;
    isPreview: boolean;
    cacheConfig: IntegrationCacheConfig;
  },
): Promise<
  { data: Record<string, any> | null; env: Record<string, string> } & {
    _fromCache: boolean;
    _stale: boolean;
  }
> {
  if (!ctx.isPreview) {
    const snapshot = ctx.cacheContext.getRuntimeSnapshot();
    if (snapshot) {
      return { ...snapshot, _fromCache: true, _stale: false };
    }
  }

  try {
    const runtime = await resolve();
    if (!ctx.isPreview) {
      ctx.cacheContext.setRuntimeSnapshot(runtime);
    }
    return { ...runtime, _fromCache: false, _stale: false };
  } catch (error) {
    if (
      !ctx.isPreview &&
      ctx.cacheConfig.policy === "cache-first"
    ) {
      const stale = ctx.cacheContext.getRuntimeSnapshot(true);
      if (stale) {
        return { ...stale, _fromCache: true, _stale: true };
      }
    }
    throw error;
  }
}

function buildCacheMeta(
  cacheConfig: IntegrationCacheConfig,
  cacheContext: ReturnType<typeof createIntegrationCacheContext>,
  fromCache = false,
  staleReturned = false,
) {
  return {
    policy: cacheConfig.policy,
    retentionSeconds: cacheConfig.retentionSeconds,
    stateKey: cacheContext.stateKey,
    fromCache,
    staleReturned,
  };
}

// --- Proxy action ---

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
    return { type: "post", url: trimmed.slice(5).trim() };
  }

  if (!trimmed.startsWith("{")) return null;

  try {
    const parsed = JSON.parse(trimmed);
    if (
      !isPlainObject(parsed) ||
      String(parsed.type ?? "").trim().toLowerCase() !== "post"
    ) return null;
    return {
      type: "post",
      url: typeof parsed.url === "string" ? parsed.url : undefined,
      auth: typeof parsed.auth === "string" ? parsed.auth : undefined,
      headers: isPlainObject(parsed.headers)
        ? (parsed.headers as Record<string, string>)
        : undefined,
      body: parsed.body,
    };
  } catch {
    return null;
  }
}

// --- Input parsers ---

function parseInputQuery(raw: string | null): Record<string, any> {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (isPlainObject(parsed)) return parsed as Record<string, any>;
    return {};
  } catch {
    throw new ApiActionError("Invalid input", 400, {
      error: "input must be valid JSON object",
    });
  }
}

function parseConsumerType(typeRaw: string | null): ConsumerType | null {
  const normalized = String(typeRaw ?? "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "widget" || normalized === "glanceable") return normalized;
  throw new ApiActionError("Invalid type", 400, {
    error: "Invalid type. Expected widget or glanceable",
  });
}

function parsePropertiesBody(raw: unknown): Record<string, any> {
  return isPlainObject(raw) ? (raw as Record<string, any>) : {};
}

function parseEnvironmentOverridesBody(raw: unknown): Record<string, string> {
  if (!isPlainObject(raw)) return {};
  return Object.entries(raw).reduce<Record<string, string>>(
    (acc, [key, value]) => {
      if (typeof value === "string") {
        acc[key] = value;
      } else if (typeof value === "number" || typeof value === "boolean") {
        acc[key] = String(value);
      }
      return acc;
    },
    {},
  );
}

// --- Response shaping ---

// Strip internal env/input fields before sending to the client.
function omitConsumerDataMeta(
  payload: Record<string, any>,
): Record<string, any> {
  const { env: _env, input: _input, fresh, ...rest } = payload;
  if (fresh && typeof fresh === "object") {
    const { env: _fe, input: _fi, ...freshRest } = fresh as Record<string, any>;
    return { ...rest, fresh: freshRest };
  }
  return { ...rest, fresh };
}

// --- Integration env helpers ---

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

function mergeEnvironmentOverrides(
  base: Record<string, any> | null | undefined,
  overrides: Record<string, string>,
) {
  return { ...(base ?? {}), ...overrides };
}

function mergeWidgetInput(
  resolvedInput: Record<string, any> | null | undefined,
  properties: Record<string, any>,
) {
  const instanceInput = isPlainObject(properties?.input)
    ? (properties.input as Record<string, any>)
    : null;
  if (!resolvedInput && !instanceInput) return null;
  return { ...(resolvedInput ?? {}), ...(instanceInput ?? {}) };
}

function mergeGlanceableInput(
  resolvedInput: Record<string, any> | null | undefined,
  properties: Record<string, any>,
) {
  const instanceInput = isPlainObject(properties?.input)
    ? (properties.input as Record<string, any>)
    : isPlainObject(properties)
    ? properties
    : null;
  return { ...(resolvedInput ?? {}), ...(instanceInput ?? {}) };
}

function mergeGlanceableJSON(
  glanceableJSON: Record<string, any>,
  properties: Record<string, any>,
) {
  if (!isPlainObject(properties)) return glanceableJSON;
  return {
    ...glanceableJSON,
    properties: { ...(glanceableJSON.properties ?? {}), ...properties },
  };
}

function resolveUserInjectedEnv(
  envVars: any,
  user: Record<string, any> | null,
): any {
  if (envVars == null) return envVars;

  const resolveString = (str: string) => {
    if (typeof str !== "string" || !str.includes("${")) return str;
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
      return typeof val === "object" ? JSON.stringify(val) : String(val);
    });
  };

  if (typeof envVars === "string") return resolveString(envVars);
  if (Array.isArray(envVars)) {
    return envVars.map((v) => resolveUserInjectedEnv(v, user));
  }
  if (typeof envVars === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(envVars)) {
      out[k] = resolveUserInjectedEnv(v, user);
    }
    return out;
  }
  return envVars;
}

function resolveStatefulEnvironmentVariables(opts: {
  envValues: Record<string, any>;
  envDefinitions: unknown;
  endpointProducedVars?: Set<string>;
  localData: unknown;
  retentionSeconds: number;
}) {
  const localData = isPlainObject(opts.localData)
    ? JSON.parse(JSON.stringify(opts.localData))
    : {};
  const hiddenEnvState: Record<string, any> =
    isPlainObject(localData.statefulEnv)
      ? localData.statefulEnv
      : (localData.statefulEnv = {});
  const values = { ...opts.envValues };
  const now = Date.now();
  let changed = false;

  if (isPlainObject(opts.envDefinitions)) {
    for (
      const [name, definitionRaw] of Object.entries(
        opts.envDefinitions as Record<string, unknown>,
      )
    ) {
      const definition = isPlainObject(definitionRaw)
        ? (definitionRaw as Record<string, any>)
        : null;
      if (!definition || definition.user_hidden !== true) continue;

      if (opts.endpointProducedVars?.has(name)) {
        if (hiddenEnvState[name] !== undefined) {
          delete hiddenEnvState[name];
          changed = true;
        }
        continue;
      }

      const state = isPlainObject(hiddenEnvState[name])
        ? (hiddenEnvState[name] as Record<string, any>)
        : null;
      const currentValue = typeof values[name] === "string"
        ? values[name].trim()
        : "";
      const stateValue = typeof state?.value === "string"
        ? state.value.trim()
        : "";
      const invalidatesAt = Number(state?.invalidatesAt);
      const hasState = Number.isFinite(invalidatesAt);
      const stateStillValid = hasState && invalidatesAt > now;

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
          invalidatesAt: now + opts.retentionSeconds * 1000,
        };
        changed = true;
        continue;
      }

      if (!state || state.value !== resolved || !hasState) {
        hiddenEnvState[name] = {
          value: resolved,
          invalidatesAt: hasState && stateStillValid
            ? invalidatesAt
            : now + opts.retentionSeconds * 1000,
        };
        changed = true;
      }
    }
  }

  return { values, localData, changed };
}

function getEndpointProducedVars(integrationJSON: Record<string, any>) {
  const result = new Set<string>();
  const endpoints = integrationJSON?.configuration?.endpoints;
  const endpointValues = Array.isArray(endpoints)
    ? endpoints
    : isPlainObject(endpoints)
    ? Object.values(endpoints)
    : null;

  if (!endpointValues) return result;

  for (const ep of endpointValues) {
    if (!isPlainObject(ep)) continue;
    const envVar = typeof ep.response?.data_set_env === "string"
      ? ep.response.data_set_env.trim()
      : "";
    if (envVar) result.add(envVar);
  }

  return result;
}

function buildConsumerStateVars(
  integrationJSON: Record<string, any>,
  input: Record<string, any>,
) {
  const rawEnv =
    isPlainObject(integrationJSON?.configuration?.environment_variables)
      ? flattenToEnv(
        integrationJSON.configuration.environment_variables as Record<
          string,
          any
        >,
      )
      : {};
  const inputEnv = flattenToEnv(isPlainObject(input) ? input : {});
  const produced = getEndpointProducedVars(integrationJSON);
  const merged = { ...rawEnv, ...inputEnv };
  for (const name of produced) delete merged[name];
  return merged;
}

function createIntegrationCacheContext(opts: {
  localData: unknown;
  type: ConsumerType;
  key: string;
  input: Record<string, any>;
  integrationJSON: Record<string, any>;
  cacheConfig: IntegrationCacheConfig;
  initialChanged?: boolean;
  sharedEndpointCache?: Map<string, ResolvedEndpointData>;
}) {
  const root: Record<string, any> = isPlainObject(opts.localData)
    ? JSON.parse(JSON.stringify(opts.localData))
    : {};
  const cacheKV: Record<string, any> = isPlainObject(root.cacheKV)
    ? root.cacheKV
    : (root.cacheKV = {});

  const statefulVars = buildConsumerStateVars(opts.integrationJSON, opts.input);
  const stateKey = Buffer.from(
    JSON.stringify(
      Object.keys(statefulVars).sort().reduce<Record<string, string>>(
        (acc, k) => {
          acc[k] = statefulVars[k];
          return acc;
        },
        {},
      ),
    ),
    "utf-8",
  ).toString("base64");

  const cacheNamespace = `${opts.type}:${opts.key}:${stateKey}`;
  const runtimeSnapshotKey = `${cacheNamespace}:runtime`;
  let changed = Boolean(opts.initialChanged);

  const readRecord = (key: string): CacheRecord | null => {
    const record = cacheKV[key];
    if (!isPlainObject(record)) return null;
    const invalidatesAt = Number((record as CacheRecord).invalidatesAt);
    if (Number.isFinite(invalidatesAt) && invalidatesAt <= Date.now()) {
      delete cacheKV[key];
      changed = true;
      return null;
    }
    return record as CacheRecord;
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

  const endpointKey = (id: string) => `${cacheNamespace}:endpoint:${id}`;

  const createEndpointCacheAdapter = (
    options?: { readEnabled?: boolean },
  ): EndpointRuntimeCacheAdapter => {
    const readEnabled = options?.readEnabled ?? true;
    return {
      get(endpointId: string): ResolvedEndpointData | null {
        if (!readEnabled) return null;
        const shared = opts.sharedEndpointCache?.get(endpointKey(endpointId));
        if (shared) return shared;
        const record = readRecord(endpointKey(endpointId));
        return record && isPlainObject(record.value)
          ? (record.value as ResolvedEndpointData)
          : null;
      },
      set(
        endpointId: string,
        payload: ResolvedEndpointData,
        expiresAt: number | null,
      ): void {
        const expires = Number(expiresAt);
        if (!Number.isFinite(expires) || expires <= Date.now()) return;
        opts.sharedEndpointCache?.set(endpointKey(endpointId), payload);
        const ttlSeconds = Math.max(
          1,
          Math.floor((expires - Date.now()) / 1000),
        );
        writeRecord(endpointKey(endpointId), payload, expires, ttlSeconds);
      },
    };
  };

  const getRuntimeSnapshot = (
    allowStale?: boolean,
  ): { data: Record<string, any> | null; env: Record<string, string> } | null => {
    if (allowStale) {
      const raw = cacheKV[runtimeSnapshotKey];
      if (!isPlainObject(raw)) return null;
      const record = raw as CacheRecord;
      if (!isPlainObject(record.value)) return null;
      const value = record.value as Record<string, unknown>;
      const env = isPlainObject(value.env)
        ? (value.env as Record<string, string>)
        : null;
      if (!env) return null;
      return {
        env,
        data: isPlainObject(value.data)
          ? (value.data as Record<string, any>)
          : null,
      };
    }
    const record = readRecord(runtimeSnapshotKey);
    if (!record || !isPlainObject(record.value)) return null;
    const value = record.value as Record<string, unknown>;
    const env = isPlainObject(value.env)
      ? (value.env as Record<string, string>)
      : null;
    if (!env) return null;
    return {
      env,
      data: isPlainObject(value.data)
        ? (value.data as Record<string, any>)
        : null,
    };
  };

  const setRuntimeSnapshot = (
    runtime: { data: Record<string, any> | null; env: Record<string, string> },
  ) => {
    writeRecord(
      runtimeSnapshotKey,
      { data: runtime.data, env: runtime.env },
      Date.now() + opts.cacheConfig.retentionSeconds * 1000,
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
  cacheContext: { changed: boolean; localData: Record<string, any> },
) {
  if (!cacheContext.changed) return;
  const pb = await getSuperuserPB();
  await pb.collection("integrations").update(integrationId, {
    localData: cacheContext.localData,
  });
}

// --- Glanceable display helpers ---

function getGlanceableIconSource(icon: unknown, env: Record<string, string>) {
  if (!icon || icon === "none") return null;
  if (typeof icon === "string") return resolveTemplatedString(icon, env);
  if (typeof icon === "object") {
    const source = (icon as Record<string, any>).source ??
      (icon as Record<string, any>).file ??
      (icon as Record<string, any>).icon ??
      (icon as Record<string, any>).value;
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
    if (resolved) return resolved;
  }
  return segments[segments.length - 1].trim();
}

function resolveGlanceableText(template: string, env: Record<string, string>) {
  const withLibDate = template.replace(
    /\$\{lib\.date\.time\(([^}]+)\)\}/g,
    (_match, rawTimezone: string) => {
      const timezone = normalizeTimezone(
        interpolateString(String(rawTimezone).trim(), env),
      );
      return timezone
        ? formatTime(new Date(), { timeZone: timezone })
        : formatTime(new Date());
    },
  );
  return resolveStringWithCasts(withLibDate, env);
}

function resolveGlanceableTextValue(
  def: unknown,
  env: Record<string, string>,
  fallbackName: string,
) {
  let text = "";

  if (typeof def === "string" && def.trim()) {
    text = resolveGlanceableText(def, env);
  } else if (def && typeof def === "object") {
    const block = def as Record<string, any>;
    if (
      String(block.operation ?? "").trim().toLowerCase() === "stringadd" &&
      Array.isArray(block.inputs)
    ) {
      const parts: string[] = [];
      for (const input of block.inputs) {
        if (!input) continue;
        if (input.show_if !== undefined) {
          const show = evaluateCondition(String(input.show_if), env);
          if (!show) continue;
        }
        const segment = typeof input === "string" ? input : input.text ?? "";
        const resolved = resolveGlanceableText(String(segment), env);
        if (resolved && resolved.trim()) parts.push(resolved);
      }
      text = parts.join("");
    } else {
      const candidate = block.text ?? block.value ?? "";
      text = candidate ? resolveGlanceableText(String(candidate), env) : "";
    }
  } else {
    text = fallbackName;
  }

  if (!text || !String(text).trim()) {
    text = fallbackName;
  }

  return text;
}

// --- Auth / user helpers ---

async function getAuthUserRecord(pb: any, userId: string) {
  try {
    const record = await pb.collection("users").getOne(userId);
    return isPlainObject(record) ? (record as Record<string, any>) : null;
  } catch {
    return null;
  }
}

function isApiNotFound(error: unknown) {
  return error instanceof ApiActionError && error.status === 404;
}

// --- Cache config ---

function resolveIntegrationCacheConfig(
  integrationJSON: Record<string, any>,
): IntegrationCacheConfig {
  const rawCache = isPlainObject(integrationJSON?.configuration?.cache)
    ? (integrationJSON.configuration.cache as Record<string, any>)
    : null;
  const policy: CachePolicy =
    String(rawCache?.policy ?? "").trim().toLowerCase() === "cache-first"
      ? "cache-first"
      : "strict";
  const rawRetention = Number(rawCache?.retention);
  const retentionSeconds = Number.isFinite(rawRetention) && rawRetention > 0
    ? rawRetention
    : 300;
  return { policy, retentionSeconds };
}

// --- Utilities ---

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeTimezone(raw: unknown): string | undefined {
  const parsed = String(raw ?? "").trim();
  if (!parsed) return undefined;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: parsed });
    return parsed;
  } catch {
    return undefined;
  }
}

function formatTime(
  input?: Date | string | number,
  opts?: Intl.DateTimeFormatOptions,
) {
  const date = input instanceof Date
    ? input
    : input
    ? new Date(input)
    : new Date();
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    ...opts,
  }).format(date);
}