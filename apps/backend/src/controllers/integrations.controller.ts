import type { Hono } from "hono";

import {
  createIntegration,
  getIntegration,
  getIntegrationWithGlanceable,
  getIntegrationWithWidget,
  getWidgetProperties,
  listIntegrations,
  testIntegrationEndpoint,
} from "@dashwise/sdk/data/integrations";
import { ApiActionError } from "@dashwise/sdk/data/auth";
import { getSuperuserPB } from "@dashwise/sdk/lib/pocketbase";
import {
  flattenToEnv,
  interpolateString,
  resolveGlanceableRuntimeData,
  resolveWidgetProperties,
  resolveWidgetRuntimeData,
} from "@dashwise/integrationskit/data/resolveProperties";
import type {
  EndpointRuntimeCacheAdapter,
  ResolvedEndpointData,
} from "@dashwise/integrationskit/data/getEndpointData";

import { readAuthToken, readBool, readJsonBody, requireAuth, withJson } from "./shared";

type ConsumerType = "widget" | "glanceable";

export function registerIntegrationsControllers(app: Hono) {
  app.get("/api/v1/integrations", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    const id = c.req.query("id") ?? undefined;
    const resolveEndpoints = readBool(c.req.query("resolveEndpoints") ?? undefined);
    if (id) {
      return getIntegration(userId, id, resolveEndpoints);
    }
    return listIntegrations(userId);
  }));
  app.post("/api/v1/integrations", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return createIntegration(userId, body?.payload ?? {});
  }));
  app.post("/api/v1/integrations/test-endpoint", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    const { userId } = await requireAuth(body?.auth);
    return testIntegrationEndpoint(userId, String(body?.target ?? ""));
  }));
  app.get("/api/v1/integrations/widget-properties", withJson(async (c) => {
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    return getWidgetProperties(userId, String(c.req.query("widgetSlug") ?? ""));
  }));
  app.get("/api/v1/integrations/consumerData", withJson(async (c) => {
    const auth = await requireAuth({ token: readAuthToken(c) });
    const typeRaw = String(c.req.query("type") ?? "").trim().toLowerCase();
    const key = String(c.req.query("key") ?? "").trim();
    const properties = parseInputQuery(c.req.query("input") ?? null);

    if (!key) {
      throw new ApiActionError("Missing key", 400, { error: "Missing key" });
    }

    const type = parseConsumerType(typeRaw || null);
    return resolveConsumerData({
      userId: auth.userId,
      pb: auth.pb,
      type,
      key,
      properties,
      isPreview: false,
    });
  }));

  const resolveConsumerPost = withJson(async (c) => {
    const auth = await requireAuth({ token: readAuthToken(c) });
    const body = await readJsonBody<any>(c);
    const key = String(body?.key ?? "").trim();
    const typeRaw = typeof body?.type === "string" ? body.type : null;
    const isPreview = Boolean(body?.isPreview);
    const properties = parsePropertiesBody(body?.properties);

    if (!key) {
      throw new ApiActionError("Missing key", 400, { error: "Missing key" });
    }

    return resolveConsumerData({
      userId: auth.userId,
      pb: auth.pb,
      type: parseConsumerType(typeRaw),
      key,
      properties,
      isPreview,
    });
  });

  app.post("/api/v1/integration/consumerData", resolveConsumerPost);
  app.post("/api/v1/integrations/consumerData", resolveConsumerPost);
}

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

async function resolveConsumerData(
  opts: {
    userId: string;
    pb: any;
    type: ConsumerType | null;
    key: string;
    properties: Record<string, any>;
    isPreview: boolean;
  },
) {
  const user = await getAuthUserRecord(opts.pb, opts.userId);

  if (opts.type === "widget") {
    return resolveWidgetConsumer({
      userId: opts.userId,
      key: opts.key,
      properties: opts.properties,
      isPreview: opts.isPreview,
      user,
    });
  }

  if (opts.type === "glanceable") {
    return resolveGlanceableConsumer({
      userId: opts.userId,
      key: opts.key,
      properties: opts.properties,
      isPreview: opts.isPreview,
      user,
    });
  }

  try {
    return await resolveWidgetConsumer({
      userId: opts.userId,
      key: opts.key,
      properties: opts.properties,
      isPreview: opts.isPreview,
      user,
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
  });
}

async function resolveWidgetConsumer(opts: {
  userId: string;
  key: string;
  properties: Record<string, any>;
  isPreview: boolean;
  user: Record<string, any> | null;
}) {
  const payload = await getIntegrationWithWidget(opts.userId, opts.key);
    if (!payload?.integrationId || !payload?.integration || !payload?.widgetJSON) {
      throw new ApiActionError("Widget integration not found", 404, {
        error: "Widget integration not found",
      });
    }

    const resolvedIntegrationEnv = resolveUserInjectedEnv(
      payload.integration?.configuration?.environment_variables,
      opts.user,
    );
    const integrationJSON = applyIntegrationEnv(
      payload.integration,
      resolvedIntegrationEnv,
    );

    const mergedInput = mergeWidgetInput(
      resolvedIntegrationEnv,
      opts.properties,
    );
    const widgetJSON = applyWidgetInput(payload.widgetJSON, mergedInput ?? {});
    const cacheContext = createEndpointCacheContext({
      localData: payload.localData,
      type: "widget",
      key: opts.key,
      input: mergedInput ?? {},
      integrationJSON,
    });

    const runtimeData = await resolveWidgetRuntimeData({
      widgetJSON,
      integrationJSON,
      data: null,
      isPreview: opts.isPreview,
      endpointCache: cacheContext.adapter,
    });

    await persistLocalDataIfChanged(payload.integrationId, cacheContext);
    return {
      consumer: "widget" as const,
      key: opts.key,
      integrationId: payload.integrationId,
      input: mergedInput,
      env: runtimeData.env,
      data: runtimeData.data,
      blueprint: {
        template: widgetJSON.template ?? "columns",
        resolved: resolveWidgetProperties({
          widgetJSON,
          integrationJSON,
          data: runtimeData.data,
          isPreview: opts.isPreview,
        }),
        widgetJSON,
      },
    };
}

async function resolveGlanceableConsumer(opts: {
  userId: string;
  key: string;
  properties: Record<string, any>;
  isPreview: boolean;
  user: Record<string, any> | null;
}) {
  const payload = await getIntegrationWithGlanceable(opts.userId, opts.key);
  if (!payload?.integrationId || !payload?.integration || !payload?.glanceableJSON) {
    throw new ApiActionError("Glanceable integration not found", 404, {
      error: "Glanceable integration not found",
    });
  }

  const resolvedIntegrationEnv = resolveUserInjectedEnv(
    payload.integration?.configuration?.environment_variables,
    opts.user,
  );
  const integrationJSON = applyIntegrationEnv(
    payload.integration,
    resolvedIntegrationEnv,
  );
  const mergedInput = mergeGlanceableInput(resolvedIntegrationEnv, opts.properties);
  const glanceableJSON = mergeGlanceableJSON(payload.glanceableJSON, opts.properties);

  const cacheContext = createEndpointCacheContext({
    localData: payload.localData,
    type: "glanceable",
    key: opts.key,
    input: mergedInput,
    integrationJSON,
  });

  const runtimeData = await resolveGlanceableRuntimeData({
    glanceableJSON,
    integrationJSON,
    data: null,
    isPreview: opts.isPreview,
    baseEnv: normalizeInputEnv(mergedInput),
    endpointCache: cacheContext.adapter,
  });

  await persistLocalDataIfChanged(payload.integrationId, cacheContext);

  const rawText = typeof glanceableJSON.text === "string"
    ? glanceableJSON.text
    : (typeof glanceableJSON.name === "string" ? glanceableJSON.name : "");

  return {
    consumer: "glanceable" as const,
    key: opts.key,
    integrationId: payload.integrationId,
    input: mergedInput,
    env: runtimeData.env,
    data: runtimeData.data,
    blueprint: {
      text: rawText ? resolveGlanceableText(rawText, runtimeData.env) : "",
      icon: getGlanceableIconSource(glanceableJSON.icon),
      glanceableJSON,
    },
  };
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

function getGlanceableIconSource(icon: unknown) {
  if (!icon || icon === "none") return null;
  if (typeof icon === "string") return icon;

  if (typeof icon === "object") {
    const iconRecord = icon as Record<string, any>;
    const source =
      iconRecord.source ??
      iconRecord.file ??
      iconRecord.icon ??
      iconRecord.value;

    if (typeof source === "string" && source.trim()) {
      return source.trim();
    }
  }

  return null;
}

function resolveGlanceableText(template: string, env: Record<string, string>) {
  const interpolated = interpolateString(template, env);

  return interpolated.replace(/\$\{lib\.date\.time\(([^}]+)\)\}/g, (_match: string, rawTimezone: string) => {
    const timezone = normalizeTimezone(interpolateString(String(rawTimezone).trim(), env));
    return timezone ? formatTime(new Date(), { timeZone: timezone }) : formatTime(new Date());
  });
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

function buildConsumerEnvSignature(
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

  return stableStringify(merged);
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

function createEndpointCacheContext(opts: {
  localData: unknown;
  type: ConsumerType;
  key: string;
  input: Record<string, any>;
  integrationJSON: Record<string, any>;
}) {
  const root = isPlainObject(opts.localData)
    ? deepClone(opts.localData as Record<string, any>)
    : {};
  const consumerDataCache = getOrCreateObject(root, "consumerDataCache");
  const consumerTypeBucket = getOrCreateObject(consumerDataCache, opts.type);
  const consumerKeyBucket = getOrCreateObject(consumerTypeBucket, opts.key);
  const integrationEnv = buildConsumerEnvSignature(opts.integrationJSON, opts.input);
  const currentIntegrationEnv = typeof consumerKeyBucket.integrationEnv === "string"
    ? consumerKeyBucket.integrationEnv
    : null;

  let changed = false;

  if (currentIntegrationEnv !== integrationEnv) {
    consumerKeyBucket.integrationEnv = integrationEnv;
    consumerKeyBucket.endpoints = {};
    consumerKeyBucket.invalidation = JSON.stringify({});
    changed = true;
  }

  const endpointsBucket = getOrCreateObject(consumerKeyBucket, "endpoints");
  let invalidation = parseInvalidationMap(consumerKeyBucket.invalidation);

  const persistInvalidation = () => {
    consumerKeyBucket.invalidation = JSON.stringify(invalidation);
  };

  if (typeof consumerKeyBucket.invalidation !== "string") {
    persistInvalidation();
    changed = true;
  }

  if (typeof consumerKeyBucket.integrationEnv !== "string") {
    consumerKeyBucket.integrationEnv = integrationEnv;
    changed = true;
  }

  const adapter: EndpointRuntimeCacheAdapter = {
    get(endpointId: string): ResolvedEndpointData | null {
      const expiresAt = Number(invalidation[endpointId]);
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        delete endpointsBucket[endpointId];
        delete invalidation[endpointId];
        persistInvalidation();
        changed = true;
        return null;
      }

      const record = endpointsBucket[endpointId];
      if (!isPlainObject(record)) {
        delete invalidation[endpointId];
        persistInvalidation();
        changed = true;
        return null;
      }

      if (!isPlainObject(record)) {
        delete endpointsBucket[endpointId];
        delete invalidation[endpointId];
        persistInvalidation();
        changed = true;
        return null;
      }

      return record as ResolvedEndpointData;
    },
    set(endpointId: string, payload: ResolvedEndpointData, expiresAt: number | null): void {
      if (!Number.isFinite(Number(expiresAt))) {
        return;
      }

      endpointsBucket[endpointId] = payload;
      invalidation[endpointId] = Number(expiresAt);
      persistInvalidation();
      changed = true;
    },
  };

  return {
    adapter,
    get changed() {
      return changed;
    },
    localData: root,
  };
}

function parseInvalidationMap(raw: unknown): Record<string, number> {
  if (typeof raw !== "string" || !raw.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    if (!isPlainObject(parsed)) {
      return {};
    }

    return Object.entries(parsed as Record<string, unknown>).reduce<Record<string, number>>((acc, [key, value]) => {
      const expiresAt = Number(value);
      if (Number.isFinite(expiresAt)) {
        acc[key] = expiresAt;
      }
      return acc;
    }, {});
  } catch {
    return {};
  }
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