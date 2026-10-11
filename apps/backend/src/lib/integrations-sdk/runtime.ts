import type {
  IntegrationDefinition,
  IntegrationConfigSchema,
  IntegrationsRuntime,
  JsonValue,
  ResourceRecord,
} from "@dashwise/integrations-sdk";
import { publishIntegrationActivity } from "../data/activities";
import { broadcastSdkResourceRevision } from "../activity";
import { ApiActionError } from "../data/auth";
import { createLogger } from "../logger";
import { ensureShortcutsApp } from "../data/shortcuts";
import { getSuperuserPB } from "../pb/pocketbase";
import { requireSdkIntegrationDefinition } from "./catalog";
import {
  decodeSdkConfig,
  getOwnedSdkInstance,
  listAllSdkInstancesForRuntime,
  listSdkResources,
  markSdkResourcesStale,
  removeSdkResource,
  setSdkStorage,
  getSdkStorage,
  removeSdkStorage,
  syncSdkResources,
  upsertSdkResource,
  type SdkInstanceRecord,
  type SdkResourceRecord,
} from "./persistence";
import { validateSdkConfig } from "./catalog";

type RuntimeResources = Record<string, Map<string, ResourceRecord>>;
type ResolvedSdkResource = SdkResourceRecord & { collectionId: string; revision: number; stale: boolean };
type RuntimeLogger = ReturnType<typeof createLogger>;
type ScheduledTask = { timer: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>; controller: AbortController };

type RuntimeEntry = {
  userId: string;
  instance: SdkInstanceRecord;
  definition: IntegrationDefinition;
  api: IntegrationsRuntime<any, any, any>;
  secretValues: string[];
  resources: RuntimeResources;
  revisions: Map<string, number>;
  cleanups: Array<() => void | Promise<void>>;
  events: Map<string, Set<(event: { name: string; payload: JsonValue }) => void | Promise<void>>>;
  scheduler: Map<string, ScheduledTask>;
  sockets: Set<WebSocket>;
  abortControllers: Set<AbortController>;
  running: boolean;
};

const logger = createLogger("SDK Integration Runtime");
const runtimes = new Map<string, RuntimeEntry>();
const startupTasks = new Map<string, Promise<void>>();
type SdkMcpToolProvider = (server: string, tool: string, input: JsonValue | undefined, signal: AbortSignal) => Promise<JsonValue>;
let mcpToolProvider: SdkMcpToolProvider | null = null;

/** Hook generic host MCP support into the integration runtime. */
export function registerSdkMcpToolProvider(provider: SdkMcpToolProvider | null) {
  mcpToolProvider = provider;
}

export async function startSdkIntegrationRuntime() {
  const instances = await listAllSdkInstancesForRuntime();
  for (const instance of instances) {
    try { await startSdkIntegrationInstance(instance.userId, instance.id); }
    catch (error) { logger.error(`Failed to start ${instance.source} instance ${instance.id}: ${messageOf(error)}`); }
  }
}

export async function stopSdkIntegrationRuntime() {
  await Promise.all([...runtimes.keys()].map((instanceId) => stopSdkIntegrationInstance(instanceId)));
}

export async function startSdkIntegrationInstance(userId: string, instanceId: string) {
  const pending = startupTasks.get(instanceId);
  if (pending) return pending;
  const task = startInstance(userId, instanceId).finally(() => startupTasks.delete(instanceId));
  startupTasks.set(instanceId, task);
  return task;
}

async function startInstance(userId: string, instanceId: string) {
  await stopSdkIntegrationInstance(instanceId);
  const { instance, row } = await getOwnedSdkInstance(userId, instanceId);
  const definition = requireSdkIntegrationDefinition(instance.source);
  const pb = await getSuperuserPB();
  for (const app of definition.apps ?? []) {
    await ensureShortcutsApp(pb, userId, sdkAppSourceId(instance.id, app.id), {
      name: app.name,
      icon: app.icon,
    });
  }
  const encryptedConfig = decodeSdkConfig(row.sdkConfig);
  const { publicConfig, secrets } = validateSdkConfig(definition, encryptedConfig);
  const persistentCollectionIds = new Set(Object.entries(definition.resources).filter(([, collection]) => collection.persistent === true).map(([id]) => id));
  if (persistentCollectionIds.size) await markSdkResourcesStale(userId, instanceId);
  const persistedResources = await listSdkResources(userId, instanceId);
  const resources: RuntimeResources = {};
  const revisions = new Map<string, number>();
  for (const [collectionId] of Object.entries(definition.resources)) resources[collectionId] = new Map();
  for (const resource of persistedResources) {
    if (!persistentCollectionIds.has(resource.collectionId)) continue;
    resources[resource.collectionId] ??= new Map();
    const { collectionId: _collectionId, revision: _revision, stale: _stale, ...record } = resource as SdkResourceRecord & { collectionId: string; revision: number; stale: boolean };
    resources[resource.collectionId].set(resource.id, record);
    revisions.set(resourceIdentity(resource.collectionId, resource.id), resource.revision);
  }

  const entry = createRuntimeEntry(userId, instance, definition, publicConfig, secrets, resources, revisions);
  runtimes.set(instanceId, entry);
  try {
    await definition.setup?.(entry.api);
    await definition.start?.(entry.api);
    entry.running = true;
    entry.api.logger.info("Integration instance started", { instanceId, source: instance.source });
  } catch (error) {
    await disposeEntry(entry, false);
    runtimes.delete(instanceId);
    throw error;
  }
}

export function sdkAppSourceId(instanceId: string, appId: string) {
  return `sdk:${instanceId}:${appId}`;
}

export async function listRuntimeSdkResources(userId: string, instanceId?: string) {
  const output: Array<SdkResourceRecord & { collectionId: string; revision: number; stale: boolean }> = [];
  for (const entry of runtimes.values()) {
    if (entry.userId !== userId || instanceId && entry.instance.id !== instanceId) continue;
    for (const [collectionId, records] of Object.entries(entry.resources)) {
      for (const resource of records.values()) {
        output.push({
          ...resource,
          collectionId,
          revision: entry.revisions.get(resourceIdentity(collectionId, resource.id)) ?? 0,
          stale: false,
        } as SdkResourceRecord & { collectionId: string; revision: number; stale: boolean });
      }
    }
  }
  return output;
}

export async function listSdkResourceSnapshot(userId: string, instanceId: string) {
  const { instance } = await getOwnedSdkInstance(userId, instanceId);
  const definition = requireSdkIntegrationDefinition(instance.source);
  const persisted = await listSdkResources(userId, instanceId) as ResolvedSdkResource[];
  const current = await listRuntimeSdkResources(userId, instanceId);
  const byIdentity = new Map<string, ResolvedSdkResource>();
  for (const resource of persisted) {
    if (definition.resources[resource.collectionId]?.persistent !== true) continue;
    byIdentity.set(`${resource.collectionId}\0${resource.id}`, resource);
  }
  for (const resource of current) byIdentity.set(`${resource.collectionId}\0${resource.id}`, resource);
  return [...byIdentity.values()];
}

export async function stopSdkIntegrationInstance(instanceId: string) {
  const entry = runtimes.get(instanceId);
  if (!entry) return;
  runtimes.delete(instanceId);
  await disposeEntry(entry, true);
}

export async function restartSdkIntegrationInstance(userId: string, instanceId: string) {
  await stopSdkIntegrationInstance(instanceId);
  return startSdkIntegrationInstance(userId, instanceId);
}

async function disposeEntry(entry: RuntimeEntry, invokeHooks: boolean) {
  if (invokeHooks) {
    try { await entry.definition.stop?.(entry.api); }
    catch (error) { entry.api.logger.error("Integration stop hook failed", { error: safeErrorMessage(entry, error) }); }
  }
  for (const task of entry.scheduler.values()) {
    task.controller.abort();
    clearTimeout(task.timer as ReturnType<typeof setTimeout>);
    clearInterval(task.timer as ReturnType<typeof setInterval>);
  }
  entry.scheduler.clear();
  for (const socket of entry.sockets) {
    try { socket.close(1000, "Integration stopped"); } catch { /* already closed */ }
  }
  entry.sockets.clear();
  for (const controller of entry.abortControllers) controller.abort();
  entry.abortControllers.clear();
  for (const cleanup of entry.cleanups.splice(0).reverse()) {
    try { await cleanup(); }
    catch (error) { entry.api.logger.warn("Integration cleanup failed", { error: safeErrorMessage(entry, error) }); }
  }
  if (invokeHooks) {
    try { await entry.definition.dispose?.(entry.api); }
    catch (error) { entry.api.logger.error("Integration dispose hook failed", { error: safeErrorMessage(entry, error) }); }
  }
  entry.running = false;
}

function createRuntimeEntry(
  userId: string,
  instance: SdkInstanceRecord,
  definition: IntegrationDefinition,
  config: Record<string, unknown>,
  secrets: Record<string, string>,
  resources: RuntimeResources,
  revisions: Map<string, number>,
): RuntimeEntry {
  const entry: RuntimeEntry = {
    userId, instance, definition, resources, revisions, secretValues: Object.values(secrets).filter((value) => value.length > 0),
    cleanups: [], events: new Map(), scheduler: new Map(), sockets: new Set(), abortControllers: new Set(),
    api: undefined as unknown as IntegrationsRuntime<any, any, any>,
    running: false,
  };
  const declaredApps = new Set((definition.apps ?? []).map((app) => app.id));
  const collections: Record<string, unknown> = {};

  for (const [collectionId, collectionDefinition] of Object.entries(definition.resources)) {
    const cache = resources[collectionId] ??= new Map();
    const declaredCollectionApps = collectionDefinition.apps?.length
      ? collectionDefinition.apps
      : (definition.apps?.length === 1 ? [definition.apps[0].id] : []);
    collections[collectionId] = {
      get(id: string) { return cache.get(id); },
      async upsert(rawResource: ResourceRecord) {
        const resource = normalizeResource(rawResource, declaredCollectionApps);
        validateAppMembership(resource, collectionDefinition.shortcuts === true, declaredCollectionApps, declaredApps);
        assertNoSecrets(entry, resource, "resource");
        const saved = collectionDefinition.persistent === true
          ? persistRuntimeResource(entry, collectionId, (await upsertSdkResource(userId, instance.id, collectionId, resource)).resource)
          : upsertRuntimeResource(entry, collectionId, resource);
        cache.set(resource.id, saved);
        return saved;
      },
      async update(id: string, changes: Partial<Omit<ResourceRecord, "id">>) {
        const existing = cache.get(id);
        if (!existing) return undefined;
        const resource = normalizeResource({ ...existing, ...changes, id }, declaredCollectionApps);
        validateAppMembership(resource, collectionDefinition.shortcuts === true, declaredCollectionApps, declaredApps);
        assertNoSecrets(entry, resource, "resource");
        const saved = collectionDefinition.persistent === true
          ? persistRuntimeResource(entry, collectionId, (await upsertSdkResource(userId, instance.id, collectionId, resource)).resource)
          : upsertRuntimeResource(entry, collectionId, resource);
        cache.set(id, saved);
        return saved;
      },
      async remove(id: string) {
        const removed = collectionDefinition.persistent === true
          ? markRuntimeResourceRemoved(entry, collectionId, id, await removeSdkResource(userId, instance.id, collectionId, id))
          : removeRuntimeResource(entry, collectionId, id);
        cache.delete(id);
        return removed;
      },
      async sync(rawResources: readonly ResourceRecord[], options: { completeness: "complete" | "partial" }) {
        const normalized = rawResources.map((resource) => normalizeResource(resource, declaredCollectionApps));
        normalized.forEach((resource) => validateAppMembership(resource, collectionDefinition.shortcuts === true, declaredCollectionApps, declaredApps));
        normalized.forEach((resource) => assertNoSecrets(entry, resource, "resource"));
        const saved = collectionDefinition.persistent === true
          ? (await syncSdkResources(userId, instance.id, collectionId, normalized, options.completeness)).resources.map((resource) => persistRuntimeResource(entry, collectionId, resource))
          : normalized.map((resource) => upsertRuntimeResource(entry, collectionId, resource));
        const returnedIds = new Set(saved.map((resource) => resource.id));
        if (options.completeness === "complete") {
          for (const id of cache.keys()) {
            if (returnedIds.has(id)) continue;
            if (collectionDefinition.persistent === true) markRuntimeResourceRemoved(entry, collectionId, id, true);
            else removeRuntimeResource(entry, collectionId, id);
            cache.delete(id);
          }
        }
        for (const resource of saved) cache.set(resource.id, resource);
      },
    };
  }

  const api: IntegrationsRuntime<any, any, any> = {
    instanceId: instance.id,
    config: Object.freeze({ ...config }),
    secrets: {
      async get(key: string) {
        if (definition.config[key]?.type !== "secret") return undefined;
        return secrets[key];
      },
    },
    resources: collections as IntegrationsRuntime<any, any, any>["resources"],
    storage: {
      async get<Value extends JsonValue = JsonValue>(key: string) {
        const value = await getSdkStorage(userId, instance.id, key);
        return value === null ? undefined : value as Value;
      },
      async set(key, value) { await setSdkStorage(userId, instance.id, key, value); },
      async delete(key) { await removeSdkStorage(userId, instance.id, key); },
    },
    actions: {
      async execute(actionId, identity, input) {
        try {
          if (identity.integrationInstanceId !== instance.id) throw new ApiActionError("Resource does not belong to this integration instance", 404);
          const result = await executeAction(entry, actionId, identity.collectionId, identity.resourceId, input);
          return { success: true, value: result as JsonValue };
        } catch (error) {
          return { success: false, error: { code: "ACTION_FAILED", message: safeErrorMessage(entry, error) } };
        }
      },
    },
    activities: {
      async publish(activity) {
        assertNoSecrets(entry, activity, "activity");
        const result = await publishIntegrationActivity(userId, instance.id, activity);
        return { id: result.activity.id, duplicate: result.duplicate };
      },
    },
    events: {
      publish(event) { for (const listener of entry.events.get(event.name) ?? []) void Promise.resolve(listener(event)).catch((error) => api.logger.warn("Event listener failed", { error: safeErrorMessage(entry, error) })); },
      subscribe(name, listener) {
        const listeners = entry.events.get(name) ?? new Set();
        listeners.add(listener);
        entry.events.set(name, listeners);
        return () => { listeners.delete(listener); if (!listeners.size) entry.events.delete(name); };
      },
    },
    http: {
      async fetch(input, init) {
        const controller = new AbortController();
        entry.abortControllers.add(controller);
        const signal = init?.signal
          ? AbortSignal.any([init.signal, controller.signal])
          : controller.signal;
        try { return await fetch(input, { ...init, signal }); }
        finally { entry.abortControllers.delete(controller); }
      },
    },
    websocket: {
      async connect(url, protocols) {
        const socket = new WebSocket(url, protocols);
        entry.sockets.add(socket);
        try {
          await new Promise<void>((resolve, reject) => {
          const onOpen = () => { socket.removeEventListener("error", onError); resolve(); };
          const onError = () => { socket.removeEventListener("open", onOpen); reject(new Error("WebSocket connection failed")); };
          socket.addEventListener("open", onOpen, { once: true });
          socket.addEventListener("error", onError, { once: true });
          });
          socket.addEventListener("close", () => entry.sockets.delete(socket), { once: true });
          return socket;
        } catch (error) {
          entry.sockets.delete(socket);
          try { socket.close(); } catch { /* already closed */ }
          throw error;
        }
      },
    },
    mcp: {
      async call<T extends JsonValue = JsonValue>(server: string, tool: string, input?: JsonValue) {
        if (!mcpToolProvider) throw new Error("No MCP tool provider is configured in this runtime");
        const controller = new AbortController();
        entry.abortControllers.add(controller);
        try { return await mcpToolProvider(server, tool, input, controller.signal) as T; }
        finally { entry.abortControllers.delete(controller); }
      },
    },
    scheduler: {
      every(name, intervalMs, task) {
        cancelScheduledTask(entry, name);
        const controller = new AbortController();
        const timer = setInterval(() => void Promise.resolve(task(controller.signal)).catch((error) => api.logger.error(`Scheduled task ${name} failed`, { error: safeErrorMessage(entry, error) })), Math.max(1, intervalMs));
        entry.scheduler.set(name, { timer, controller });
      },
      timeout(name, delayMs, task) {
        cancelScheduledTask(entry, name);
        const controller = new AbortController();
        const timer = setTimeout(() => {
          entry.scheduler.delete(name);
          void Promise.resolve(task(controller.signal)).catch((error) => api.logger.error(`Scheduled task ${name} failed`, { error: safeErrorMessage(entry, error) }));
        }, Math.max(0, delayMs));
        entry.scheduler.set(name, { timer, controller });
      },
      cancel(name) { cancelScheduledTask(entry, name); },
    },
    logger: {
      debug(message, metadata) { logger.debug(`[${instance.id}] ${message}`, metadata); },
      info(message, metadata) { logger.info(`[${instance.id}] ${message}`, metadata); },
      warn(message, metadata) { logger.warn(`[${instance.id}] ${message}`, metadata); },
      error(message, metadata) { logger.error(`[${instance.id}] ${message}`, metadata); },
    },
    onDispose(cleanup) { entry.cleanups.push(cleanup); },
  };
  entry.api = api;
  return entry;
}

export async function executeSdkIntegrationAction(
  userId: string,
  instanceId: string,
  actionId: string,
  resource: { collectionId: string; resourceId: string },
  input: unknown,
) {
  const { instance } = await getOwnedSdkInstance(userId, instanceId);
  let entry = runtimes.get(instanceId);
  if (!entry) {
    await startSdkIntegrationInstance(userId, instanceId);
    entry = runtimes.get(instanceId);
  }
  if (!entry || entry.userId !== userId) throw new ApiActionError("Integration instance is unavailable", 503, { error: "Integration instance is unavailable" });
  try {
    return await executeAction(entry, actionId, resource.collectionId, resource.resourceId, input);
  } catch (error) {
    if (error instanceof ApiActionError && safeErrorMessage(entry, error) === error.message) throw error;
    entry.api.logger.error("Integration action failed", { actionId, error: safeErrorMessage(entry, error) });
    throw new ApiActionError("Integration action failed", 502, { error: "Integration action failed" });
  }
}

/** Resolve a contribution's selector IDs to current, owner-scoped SDK resources. */
export async function resolveSdkContributionBindings(
  userId: string,
  instanceId: string,
  kind: "widget" | "glanceable",
  contributionId: string,
  rawConfig: unknown,
) {
  const { instance } = await getOwnedSdkInstance(userId, instanceId);
  const definition = requireSdkIntegrationDefinition(instance.source);
  const contributions = kind === "widget" ? definition.widgets ?? [] : definition.glanceables ?? [];
  const contribution = contributions.find((item) => item.id === contributionId);
  if (!contribution) throw new ApiActionError("Integration contribution not found", 404, { error: "Integration contribution not found" });
  if (!isObject(rawConfig)) throw new ApiActionError("Contribution config must be an object", 400, { error: "Contribution config must be an object" });
  const configSchema = (contribution.configSchema ?? {}) as IntegrationConfigSchema;
  if (Object.keys(rawConfig).some((key) => !(key in configSchema))) {
    throw new ApiActionError("Contribution config contains an unknown field", 400, { error: "Contribution config contains an unknown field" });
  }
  for (const [key, field] of Object.entries(configSchema)) {
    if (field.required && rawConfig[key] === undefined && field.default === undefined) {
      throw new ApiActionError(`Missing contribution config: ${key}`, 400, { error: `Missing contribution config: ${key}` });
    }
  }
  const resources = await listSdkResourceSnapshot(userId, instanceId);
  const data: Record<string, ResourceRecord | ResourceRecord[] | null> = {};
  const revisions = new Map<string, { instanceId: string; collectionId: string; resourceId: string; revision: number }>();
  for (const [outputKey, binding] of Object.entries(contribution.resourceBindings ?? {})) {
    const field = configSchema[binding.configKey];
    if (field?.type !== "shortcut-select") {
      throw new ApiActionError("Invalid contribution resource binding", 500, { error: "Invalid contribution resource binding" });
    }
    const selected = rawConfig[binding.configKey] ?? field.default ?? (field.multiple ? [] : "");
    if (field.multiple) {
      if (!Array.isArray(selected) || selected.some((id) => typeof id !== "string")) {
        throw new ApiActionError(`Invalid contribution config: ${binding.configKey}`, 400, { error: `Invalid contribution config: ${binding.configKey}` });
      }
      if (new Set(selected).size !== selected.length) throw new ApiActionError(`Duplicate selected resource: ${binding.configKey}`, 400, { error: `Duplicate selected resource: ${binding.configKey}` });
      data[outputKey] = selected.map((id) => resolveSelectedResource(resources, definition, instanceId, id, field.appIds, field.collectionIds, revisions)).filter((item): item is ResourceRecord => item !== null);
    } else {
      if (typeof selected !== "string") {
        throw new ApiActionError(`Invalid contribution config: ${binding.configKey}`, 400, { error: `Invalid contribution config: ${binding.configKey}` });
      }
      data[outputKey] = selected
        ? resolveSelectedResource(resources, definition, instanceId, selected, field.appIds, field.collectionIds, revisions)
        : null;
    }
  }
  return { data, revisions: [...revisions.values()] };
}

function resolveSelectedResource(
  resources: ResolvedSdkResource[],
  definition: IntegrationDefinition,
  instanceId: string,
  resourceId: string,
  appIds?: readonly string[],
  collectionIds?: readonly string[],
  revisions?: Map<string, { instanceId: string; collectionId: string; resourceId: string; revision: number }>,
) {
  const candidates = resources.filter((resource) => resource.id === resourceId
    && definition.resources[resource.collectionId]?.shortcuts === true
    && (!collectionIds?.length || collectionIds.includes(resource.collectionId))
    && (!appIds?.length || appIds.some((appId) => resource.apps?.includes(appId))));
  if (candidates.length > 1) throw new ApiActionError("Selected resource ID is ambiguous; configure a collection filter", 400, { error: "Selected resource ID is ambiguous" });
  const existing = resources.some((resource) => resource.id === resourceId
    && definition.resources[resource.collectionId]?.shortcuts === true);
  if (existing && candidates.length === 0) throw new ApiActionError("Selected resource does not match this selector's App or collection filters", 400, { error: "Selected resource does not match selector filters" });
  const candidate = candidates[0];
  if (!candidate) {
    for (const [collectionId, collection] of Object.entries(definition.resources)) {
      if (!collection.shortcuts || collectionIds?.length && !collectionIds.includes(collectionId)) continue;
      const collectionApps = collection.apps?.length
        ? collection.apps
        : (definition.apps?.length === 1 ? [definition.apps[0].id] : []);
      if (appIds?.length && !appIds.some((appId) => collectionApps.includes(appId))) continue;
      revisions?.set(`${instanceId}\0${collectionId}\0${resourceId}`, {
        instanceId, collectionId, resourceId, revision: 0,
      });
    }
    return null;
  }
  revisions?.set(`${instanceId}\0${candidate.collectionId}\0${candidate.id}`, {
    instanceId, collectionId: candidate.collectionId, resourceId: candidate.id, revision: candidate.revision,
  });
  const { collectionId: _collectionId, revision: _revision, stale: _stale, ...record } = candidate;
  return record;
}

async function executeAction(entry: RuntimeEntry, actionId: string, collectionId: string, resourceId: string, input: unknown) {
  const action = Object.values(entry.definition.actions ?? {}).find((candidate) => candidate.id === actionId);
  if (!action) throw new ApiActionError("Action is not declared by this integration", 404, { error: "Action is not declared by this integration" });
  const collection = entry.definition.resources[collectionId];
  if (!collection) throw new ApiActionError("Resource collection not found", 404, { error: "Resource collection not found" });
  const resource = entry.resources[collectionId]?.get(resourceId);
  if (!resource) throw new ApiActionError("Resource not found", 404, { error: "Resource not found" });
  if (resource.available === false) throw new ApiActionError("Resource is unavailable", 409, { error: "Resource is unavailable" });
  if (!resource.actions?.includes(actionId)) throw new ApiActionError("Action is not available for this resource", 403, { error: "Action is not available for this resource" });
  validateJsonSchema(input, action.inputSchema, "action input");
  const result = await action.execute(entry.api, resource, input);
  assertNoSecrets(entry, result, "action result");
  return result;
}

function validateAppMembership(resource: ResourceRecord, shortcuts: boolean, defaults: readonly string[], declaredApps: Set<string>) {
  const assigned = resource.apps?.length ? resource.apps : defaults;
  if (shortcuts && assigned.length === 0) throw new ApiActionError("Shortcut resources must belong to at least one App", 400, { error: "Shortcut resources must belong to at least one App" });
  if (assigned.some((appId) => !declaredApps.has(appId))) throw new ApiActionError("Resource references an undeclared App", 400, { error: "Resource references an undeclared App" });
}

function normalizeResource(resource: ResourceRecord, defaults: readonly string[] = []): SdkResourceRecord {
  return {
    ...resource,
    apps: resource.apps?.length ? resource.apps : (defaults.length ? defaults : undefined),
    updatedAt: resource.updatedAt ?? new Date().toISOString(),
  };
}

function resourceIdentity(collectionId: string, resourceId: string) {
  return `${collectionId}\0${resourceId}`;
}

function persistRuntimeResource(entry: RuntimeEntry, collectionId: string, resource: SdkResourceRecord) {
  const revision = (resource as ResolvedSdkResource).revision;
  if (Number.isFinite(revision)) entry.revisions.set(resourceIdentity(collectionId, resource.id), revision);
  return resource;
}

function upsertRuntimeResource(entry: RuntimeEntry, collectionId: string, resource: SdkResourceRecord) {
  const cache = entry.resources[collectionId] ??= new Map();
  const previous = cache.get(resource.id);
  const identity = resourceIdentity(collectionId, resource.id);
  const revision = entry.revisions.get(identity) ?? 0;
  if (previous && stableJson(previous) === stableJson(resource)) return previous;
  const nextRevision = revision + 1;
  entry.revisions.set(identity, nextRevision);
  broadcastSdkResourceRevision(entry.userId, {
    instanceId: entry.instance.id,
    collectionId,
    resourceId: resource.id,
    revision: nextRevision,
    operation: "upsert",
  });
  return resource;
}

function markRuntimeResourceRemoved(entry: RuntimeEntry, collectionId: string, resourceId: string, removed: boolean) {
  if (!removed) return false;
  const identity = resourceIdentity(collectionId, resourceId);
  const revision = (entry.revisions.get(identity) ?? 0) + 1;
  entry.revisions.set(identity, revision);
  return true;
}

function removeRuntimeResource(entry: RuntimeEntry, collectionId: string, resourceId: string) {
  const removed = Boolean(entry.resources[collectionId]?.has(resourceId));
  if (!removed) return false;
  const revision = (entry.revisions.get(resourceIdentity(collectionId, resourceId)) ?? 0) + 1;
  entry.revisions.set(resourceIdentity(collectionId, resourceId), revision);
  broadcastSdkResourceRevision(entry.userId, {
    instanceId: entry.instance.id,
    collectionId,
    resourceId,
    revision,
    operation: "remove",
  });
  return true;
}

function validateJsonSchema(value: unknown, schema: import("@dashwise/integrations-sdk").JsonSchema | undefined, label: string) {
  if (!schema) return;
  if (schema.enum && !schema.enum.some((candidate) => stableJson(candidate) === stableJson(value))) throw new ApiActionError(`Invalid ${label}`, 400, { error: `Invalid ${label}` });
  if (!schema.type) return;
  const validType = schema.type === "null" ? value === null
    : schema.type === "array" ? Array.isArray(value)
      : schema.type === "object" ? isObject(value)
        : schema.type === "integer" ? typeof value === "number" && Number.isInteger(value)
          : schema.type === "number" ? typeof value === "number" && Number.isFinite(value)
            : schema.type === "boolean" ? typeof value === "boolean"
              : schema.type === "string" ? typeof value === "string" : true;
  if (!validType) throw new ApiActionError(`Invalid ${label}`, 400, { error: `Invalid ${label}` });
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength || schema.maxLength !== undefined && value.length > schema.maxLength) throw new ApiActionError(`Invalid ${label}`, 400, { error: `Invalid ${label}` });
  }
  if (typeof value === "number" && (schema.minimum !== undefined && value < schema.minimum || schema.maximum !== undefined && value > schema.maximum)) throw new ApiActionError(`Invalid ${label}`, 400, { error: `Invalid ${label}` });
  if (Array.isArray(value) && schema.items) value.forEach((item) => validateJsonSchema(item, schema.items, label));
  if (isObject(value)) {
    for (const required of schema.required ?? []) if (!(required in value)) throw new ApiActionError(`Invalid ${label}`, 400, { error: `Missing ${label} field: ${required}` });
    for (const [key, child] of Object.entries(value)) {
      const childSchema = schema.properties?.[key];
      if (childSchema) validateJsonSchema(child, childSchema, label);
      else if (schema.additionalProperties === false) throw new ApiActionError(`Invalid ${label}`, 400, { error: `Unknown ${label} field: ${key}` });
      else if (isObject(schema.additionalProperties)) validateJsonSchema(child, schema.additionalProperties, label);
    }
  }
}

function cancelScheduledTask(entry: RuntimeEntry, name: string) {
  const existing = entry.scheduler.get(name);
  if (!existing) return;
  existing.controller.abort();
  clearTimeout(existing.timer as ReturnType<typeof setTimeout>);
  clearInterval(existing.timer as ReturnType<typeof setInterval>);
  entry.scheduler.delete(name);
}

function stableJson(value: unknown) {
  return JSON.stringify(value, (_key, child) => !child || typeof child !== "object" || Array.isArray(child)
    ? child
    : Object.fromEntries(Object.entries(child).sort(([a], [b]) => a.localeCompare(b))));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function messageOf(error: unknown) { return error instanceof Error ? error.message : String(error); }

function safeErrorMessage(entry: RuntimeEntry, error: unknown) {
  const message = messageOf(error);
  return entry.secretValues.some((secret) => message.includes(secret)) ? "Integration action failed" : message;
}

function assertNoSecrets(entry: RuntimeEntry, value: unknown, label: string) {
  let serialized = "";
  try { serialized = JSON.stringify(value); } catch { return; }
  if (entry.secretValues.some((secret) => serialized.includes(secret))) {
    throw new ApiActionError(`A ${label} cannot contain configured secrets`, 400, { error: `A ${label} cannot contain configured secrets` });
  }
}
