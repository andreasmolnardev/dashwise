import { Hono } from "hono";
import { ApiActionError } from "../lib/data/auth";
import { listSdkIntegrationCatalog, requireSdkIntegrationDefinition, validateSdkConfig } from "../lib/integrations-sdk/catalog";
import {
  createSdkInstance,
  decodeSdkConfig,
  deleteSdkInstance,
  getOwnedSdkInstance,
  listSdkInstances,
  updateSdkInstance,
} from "../lib/integrations-sdk/persistence";
import { executeSdkIntegrationAction, listSdkResourceSnapshot, resolveSdkContributionBindings, restartSdkIntegrationInstance, startSdkIntegrationInstance, stopSdkIntegrationInstance } from "../lib/integrations-sdk/runtime";
import { readAuthToken, readJsonBody, requireAuth, withJson } from "./shared";

const sdkIntegrationsRoute = new Hono();

async function requireSdkUser(token: string | null) {
  const { userId } = await requireAuth({ token });
  if (!userId) throw new ApiActionError("Unauthorized", 401, { error: "Unauthorized" });
  return userId;
}

sdkIntegrationsRoute.get("/api/v1/sdk-integrations/catalog", withJson(async (c) => {
  await requireSdkUser(readAuthToken(c));
  return { integrations: listSdkIntegrationCatalog() };
}));

sdkIntegrationsRoute.get("/api/v1/sdk-integrations/instances", withJson(async (c) => {
  const userId = await requireSdkUser(readAuthToken(c));
  const instances = await listSdkInstances(userId);
  return { instances: await Promise.all(instances.map((instance) => instanceResponse(userId, instance.id))) };
}));

sdkIntegrationsRoute.post("/api/v1/sdk-integrations/instances", withJson(async (c) => {
  const userId = await requireSdkUser(readAuthToken(c));
  const body = await readJsonBody<Record<string, unknown>>(c);
  const source = typeof body.source === "string" ? body.source.trim() : "";
  if (!source) throw new ApiActionError("Integration source is required", 400, { error: "Integration source is required" });
  const definition = requireSdkIntegrationDefinition(source);
  const config = validateSdkConfig(definition, body.config ?? {}).complete;
  const instance = await createSdkInstance(userId, {
    source,
    name: typeof body.name === "string" ? body.name : undefined,
    config,
  });
  await startSdkIntegrationInstance(userId, instance.id).catch(() => undefined);
  return { instance: await instanceResponse(userId, instance.id) };
}));

sdkIntegrationsRoute.get("/api/v1/sdk-integrations/instances/:id", withJson(async (c) => {
  const userId = await requireSdkUser(readAuthToken(c));
  return { instance: await instanceResponse(userId, requireId(c.req.param("id"))) };
}));

sdkIntegrationsRoute.patch("/api/v1/sdk-integrations/instances/:id", withJson(async (c) => {
  const userId = await requireSdkUser(readAuthToken(c));
  const id = requireId(c.req.param("id"));
  const { instance, row } = await getOwnedSdkInstance(userId, id);
  const body = await readJsonBody<Record<string, unknown>>(c);
  const update: { name?: string; config?: Record<string, unknown>; enabled?: boolean } = {};
  if (body.name !== undefined) {
    if (typeof body.name !== "string") throw new ApiActionError("Name must be a string", 400, { error: "Name must be a string" });
    update.name = body.name;
  }
  if (body.config !== undefined) {
    const definition = requireSdkIntegrationDefinition(instance.source);
    const current = decodeSdkConfig(row.sdkConfig);
    const incoming = body.config;
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
      throw new ApiActionError("Integration config must be an object", 400, { error: "Integration config must be an object" });
    }
    const merged = { ...current, ...(incoming as Record<string, unknown>) };
    update.config = validateSdkConfig(definition, merged, current).complete;
  }
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") throw new ApiActionError("Enabled must be a boolean", 400, { error: "Enabled must be a boolean" });
    update.enabled = body.enabled;
  }
  await updateSdkInstance(userId, id, update);
  if (body.enabled === false) await stopSdkIntegrationInstance(id);
  else if (body.enabled === true || body.config !== undefined) await restartSdkIntegrationInstance(userId, id).catch(() => undefined);
  return { instance: await instanceResponse(userId, id) };
}));

sdkIntegrationsRoute.delete("/api/v1/sdk-integrations/instances/:id", withJson(async (c) => {
  const userId = await requireSdkUser(readAuthToken(c));
  const id = requireId(c.req.param("id"));
  await getOwnedSdkInstance(userId, id);
  await stopSdkIntegrationInstance(id);
  return deleteSdkInstance(userId, id);
}));

sdkIntegrationsRoute.get("/api/v1/sdk-integrations/instances/:id/resources", withJson(async (c) => {
  const userId = await requireSdkUser(readAuthToken(c));
  const instanceId = requireId(c.req.param("id"));
  const { instance } = await getOwnedSdkInstance(userId, instanceId);
  const definition = requireSdkIntegrationDefinition(instance.source);
  const url = new URL(c.req.url);
  const collectionIds = queryIds(url.searchParams, "collectionIds", "collectionId");
  const appIds = queryIds(url.searchParams, "appIds", "appId");
  const resourceIds = queryIds(url.searchParams, "resourceIds", "resourceId");
  const declaredAppIds = new Set((definition.apps ?? []).map((app) => app.id));
  for (const collectionId of collectionIds) {
    if (!definition.resources[collectionId]?.shortcuts) throw new ApiActionError("Unknown Shortcut collection", 400, { error: "Unknown Shortcut collection" });
  }
  for (const appId of appIds) {
    if (!declaredAppIds.has(appId)) throw new ApiActionError("Unknown integration App", 400, { error: "Unknown integration App" });
  }
  const resources = await listSdkResourceSnapshot(userId, instanceId);
  return {
    resources: resources.filter((resource) =>
      (!collectionIds.length || collectionIds.includes(resource.collectionId))
      && (!appIds.length || appIds.some((appId) => resource.apps?.includes(appId)))
      && (!resourceIds.length || resourceIds.includes(resource.id))),
  };
}));

sdkIntegrationsRoute.get("/api/v1/sdk-integrations/instances/:id/contributions/:kind/:contributionId", withJson(async (c) => {
  const userId = await requireSdkUser(readAuthToken(c));
  const { instance } = await getOwnedSdkInstance(userId, requireId(c.req.param("id")));
  const definition = requireSdkIntegrationDefinition(instance.source);
  const kind = c.req.param("kind");
  if (kind !== "widget" && kind !== "glanceable") {
    throw new ApiActionError("Contribution kind must be widget or glanceable", 400, { error: "Contribution kind must be widget or glanceable" });
  }
  const contributionId = requireId(c.req.param("contributionId"));
  const contribution = (kind === "widget" ? definition.widgets : definition.glanceables)
    ?.find((entry) => entry.id === contributionId);
  if (!contribution) throw new ApiActionError("Integration contribution not found", 404, { error: "Integration contribution not found" });
  return { contribution };
}));

sdkIntegrationsRoute.post("/api/v1/sdk-integrations/instances/:id/contributions/:kind/:contributionId/resolve", withJson(async (c) => {
  const userId = await requireSdkUser(readAuthToken(c));
  const instanceId = requireId(c.req.param("id"));
  const kind = c.req.param("kind");
  if (kind !== "widget" && kind !== "glanceable") {
    throw new ApiActionError("Contribution kind must be widget or glanceable", 400, { error: "Contribution kind must be widget or glanceable" });
  }
  const body = await readJsonBody<Record<string, unknown>>(c);
  return resolveSdkContributionBindings(userId, instanceId, kind, requireId(c.req.param("contributionId")), body.config);
}));

sdkIntegrationsRoute.post("/api/v1/sdk-integrations/instances/:id/actions/:actionId", withJson(async (c) => {
  const userId = await requireSdkUser(readAuthToken(c));
  const body = await readJsonBody<Record<string, unknown>>(c);
  if (typeof body.collectionId !== "string" || typeof body.resourceId !== "string") {
    throw new ApiActionError("A resource collection and resource id are required", 400, { error: "A resource collection and resource id are required" });
  }
  const result = await executeSdkIntegrationAction(
    userId,
    requireId(c.req.param("id")),
    requireId(c.req.param("actionId")),
    { collectionId: body.collectionId, resourceId: body.resourceId },
    body.input,
  );
  return { result };
}));

async function instanceResponse(userId: string, id: string) {
  const { instance, row } = await getOwnedSdkInstance(userId, id);
  const definition = requireSdkIntegrationDefinition(instance.source);
  const { publicConfig, secrets } = validateSdkConfig(definition, decodeSdkConfig(row.sdkConfig));
  return {
    ...instance,
    config: publicConfig,
    configuredSecrets: Object.keys(secrets),
  };
}

function requireId(value: string | undefined) {
  if (!value) throw new ApiActionError("Not found", 404, { error: "Not found" });
  return value;
}

function queryIds(params: URLSearchParams, plural: string, singular: string) {
  const values = [...params.getAll(plural), ...params.getAll(singular)]
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(values)].slice(0, 200);
}

export default sdkIntegrationsRoute;
