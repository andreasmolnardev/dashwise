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
  resolveGlanceableRuntimeData,
  resolveWidgetRuntimeData,
} from "../../../../packages/integrationskit/data/resolveProperties";
import type {
  EndpointRuntimeCacheAdapter,
  ResolvedEndpointData,
} from "../../../../packages/integrationskit/data/getEndpointData";

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
    const { userId } = await requireAuth({ token: readAuthToken(c) });
    const typeRaw = String(c.req.query("type") ?? "").trim().toLowerCase();
    const key = String(c.req.query("key") ?? "").trim();
    const input = parseInputQuery(c.req.query("input") ?? null);

    if (!key) {
      throw new ApiActionError("Missing key", 400, { error: "Missing key" });
    }

    if (typeRaw !== "widget" && typeRaw !== "glanceable") {
      throw new ApiActionError("Invalid type", 400, {
        error: "Invalid type. Expected widget or glanceable",
      });
    }

    return resolveConsumerData(userId, typeRaw, key, input);
  }));
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
  userId: string,
  type: ConsumerType,
  key: string,
  input: Record<string, any>,
) {
  if (type === "widget") {
    const payload = await getIntegrationWithWidget(userId, key);
    if (!payload?.integrationId || !payload?.integration || !payload?.widgetJSON) {
      throw new ApiActionError("Widget integration not found", 404, {
        error: "Widget integration not found",
      });
    }

    const widgetJSON = applyWidgetInput(payload.widgetJSON, input);
    const cacheContext = createEndpointCacheContext({
      localData: payload.localData,
      type,
      key,
      input,
      integrationJSON: payload.integration,
    });

    const runtimeData = await resolveWidgetRuntimeData({
      widgetJSON,
      integrationJSON: payload.integration,
      data: null,
      isPreview: false,
      endpointCache: cacheContext.adapter,
    });

    await persistLocalDataIfChanged(payload.integrationId, cacheContext);
    return { data: runtimeData.data, env: runtimeData.env };
  }

  const payload = await getIntegrationWithGlanceable(userId, key);
  if (!payload?.integrationId || !payload?.integration || !payload?.glanceableJSON) {
    throw new ApiActionError("Glanceable integration not found", 404, {
      error: "Glanceable integration not found",
    });
  }

  const cacheContext = createEndpointCacheContext({
    localData: payload.localData,
    type,
    key,
    input,
    integrationJSON: payload.integration,
  });

  const runtimeData = await resolveGlanceableRuntimeData({
    glanceableJSON: payload.glanceableJSON,
    integrationJSON: payload.integration,
    data: null,
    isPreview: false,
    baseEnv: normalizeInputEnv(input),
    endpointCache: cacheContext.adapter,
  });

  await persistLocalDataIfChanged(payload.integrationId, cacheContext);
  return { data: runtimeData.data, env: runtimeData.env };
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
  const envKey = buildConsumerEnvSignature(opts.integrationJSON, opts.input);
  const envBucket = getOrCreateObject(consumerKeyBucket, envKey);
  const endpointsBucket = getOrCreateObject(envBucket, "endpoints");

  let changed = false;

  const adapter: EndpointRuntimeCacheAdapter = {
    get(endpointId: string): ResolvedEndpointData | null {
      const record = endpointsBucket[endpointId];
      if (!isPlainObject(record)) {
        return null;
      }

      const expiresAt = Number(record.expiresAt);
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        delete endpointsBucket[endpointId];
        changed = true;
        return null;
      }

      if (!isPlainObject(record.payload)) {
        delete endpointsBucket[endpointId];
        changed = true;
        return null;
      }

      return record.payload as ResolvedEndpointData;
    },
    set(endpointId: string, payload: ResolvedEndpointData, expiresAt: number | null): void {
      if (!Number.isFinite(Number(expiresAt))) {
        return;
      }

      endpointsBucket[endpointId] = {
        payload,
        expiresAt,
      };
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