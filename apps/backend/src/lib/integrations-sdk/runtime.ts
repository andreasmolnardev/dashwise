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
import { assertSafeIntegrationUrl, createGuardedIntegrationWebSocket, guardedIntegrationFetch } from "./network-guard";

type RuntimeResources = Record<string, Map<string, ResourceRecord>>;
type ResolvedSdkResource = SdkResourceRecord & { collectionId: string; revision: number; stale: boolean };
type RuntimeLogger = ReturnType<typeof createLogger>;
type ScheduledTask = { timer: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>; controller: AbortController };
export type SdkIntegrationRuntimeStatus = {
  state: "disabled" | "stopped" | "starting" | "ready" | "error";
  updatedAt: string;
  message?: string;
};

type RuntimeEntry = {
  userId: string;
  instance: SdkInstanceRecord;
  definition: IntegrationDefinition;
  api: IntegrationsRuntime<any, any, any>;
  secretValues: string[];
  resources: RuntimeResources;
  revisions: Map<string, number>;
  staleResources: Set<string>;
  cleanups: Array<() => void | Promise<void>>;
  events: Map<string, Set<(event: { name: string; payload: JsonValue }) => void | Promise<void>>>;
  scheduler: Map<string, ScheduledTask>;
  sockets: Set<WebSocket>;
  abortControllers: Set<AbortController>;
  activeActionResources: Set<string>;
  running: boolean;
};

const logger = createLogger("SDK Integration Runtime");
const runtimes = new Map<string, RuntimeEntry>();
const startupTasks = new Map<string, Promise<void>>();
const lifecycleTasks = new Map<string, Promise<void>>();
const runtimeStatuses = new Map<string, SdkIntegrationRuntimeStatus>();
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
  const instanceIds = new Set([...runtimes.keys(), ...lifecycleTasks.keys()]);
  await Promise.all([...instanceIds].map((instanceId) => stopSdkIntegrationInstance(instanceId)));
}

export async function startSdkIntegrationInstance(userId: string, instanceId: string) {
  const pending = startupTasks.get(instanceId);
  if (pending) return pending;
  const task = runInstanceLifecycle(instanceId, async () => {
    try {
      await startInstance(userId, instanceId);
    } catch (error) {
      if (runtimeStatuses.get(instanceId)?.state === "starting") {
        setRuntimeStatus(instanceId, "error", "Integration failed before it could start.");
      }
      throw error;
    }
  }).finally(() => startupTasks.delete(instanceId));
  startupTasks.set(instanceId, task);
  return task;
}

async function startInstance(userId: string, instanceId: string) {
  await stopInstance(instanceId);
  setRuntimeStatus(instanceId, "starting");
  const { instance, row } = await getOwnedSdkInstance(userId, instanceId);
  if (!instance.enabled) {
    setRuntimeStatus(instanceId, "disabled");
    return;
  }
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
  const staleResources = new Set<string>();
  for (const [collectionId] of Object.entries(definition.resources)) resources[collectionId] = new Map();
  for (const resource of persistedResources) {
    if (!persistentCollectionIds.has(resource.collectionId)) continue;
    resources[resource.collectionId] ??= new Map();
    const { collectionId: _collectionId, revision: _revision, stale: _stale, ...record } = resource as SdkResourceRecord & { collectionId: string; revision: number; stale: boolean };
    resources[resource.collectionId].set(resource.id, record);
    revisions.set(resourceIdentity(resource.collectionId, resource.id), resource.revision);
    if (resource.stale) staleResources.add(resourceIdentity(resource.collectionId, resource.id));
  }

  const entry = createRuntimeEntry(userId, instance, definition, publicConfig, secrets, resources, revisions, staleResources);
  runtimes.set(instanceId, entry);
  try {
    await definition.setup?.(entry.api);
    await definition.start?.(entry.api);
    entry.running = true;
    setRuntimeStatus(instanceId, "ready");
    entry.api.logger.info("Integration instance started", { instanceId, source: instance.source });
  } catch (error) {
    setRuntimeStatus(instanceId, "error", safeErrorMessage(entry, error));
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
          stale: entry.staleResources.has(resourceIdentity(collectionId, resource.id)),
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
    byIdentity.set(`${resource.collectionId}\0${resource.id}`, {
      ...resource,
      stale: !instance.enabled || resource.stale,
    });
  }
  for (const resource of current) byIdentity.set(`${resource.collectionId}\0${resource.id}`, resource);
  return [...byIdentity.values()];
}

export async function stopSdkIntegrationInstance(instanceId: string) {
  return runInstanceLifecycle(instanceId, () => stopInstance(instanceId));
}

async function stopInstance(instanceId: string) {
  const entry = runtimes.get(instanceId);
  if (!entry) {
    setRuntimeStatus(instanceId, "stopped");
    return;
  }
  runtimes.delete(instanceId);
  await disposeEntry(entry, true);
  setRuntimeStatus(instanceId, "stopped");
}

export async function getSdkIntegrationRuntimeStatus(userId: string, instanceId: string) {
  const { instance } = await getOwnedSdkInstance(userId, instanceId);
  if (!instance.enabled) return { state: "disabled", updatedAt: instance.updated } satisfies SdkIntegrationRuntimeStatus;
  return runtimeStatuses.get(instanceId) ?? { state: "stopped", updatedAt: instance.updated } satisfies SdkIntegrationRuntimeStatus;
}

export function forgetSdkIntegrationRuntimeStatus(instanceId: string) {
  runtimeStatuses.delete(instanceId);
}

function setRuntimeStatus(instanceId: string, state: SdkIntegrationRuntimeStatus["state"], message?: string) {
  runtimeStatuses.set(instanceId, {
    state,
    updatedAt: new Date().toISOString(),
    ...(message ? { message } : {}),
  });
}

export async function restartSdkIntegrationInstance(userId: string, instanceId: string) {
  return runInstanceLifecycle(instanceId, async () => {
    try {
      await startInstance(userId, instanceId);
    } catch (error) {
      if (runtimeStatuses.get(instanceId)?.state === "starting") {
        setRuntimeStatus(instanceId, "error", "Integration failed before it could start.");
      }
      throw error;
    }
  });
}

function runInstanceLifecycle(instanceId: string, operation: () => Promise<void>) {
  const previous = lifecycleTasks.get(instanceId);
  const task = (previous?.catch(() => undefined) ?? Promise.resolve()).then(operation);
  lifecycleTasks.set(instanceId, task);
  void task.finally(() => {
    if (lifecycleTasks.get(instanceId) === task) lifecycleTasks.delete(instanceId);
  }).catch(() => undefined);
  return task;
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
  staleResources: Set<string>,
): RuntimeEntry {
  const entry: RuntimeEntry = {
    userId, instance, definition, resources, revisions, staleResources, secretValues: Object.values(secrets).filter((value) => value.length > 0),
    cleanups: [], events: new Map(), scheduler: new Map(), sockets: new Set(), abortControllers: new Set(), activeActionResources: new Set(),
    api: undefined as unknown as IntegrationsRuntime<any, any, any>,
    running: false,
  };
  const declaredApps = new Set((definition.apps ?? []).map((app) => app.id));
  const allowedPrivateUrls = Object.entries(definition.config)
    .filter(([key, field]) => field.type === "url" && typeof config[key] === "string")
    .map(([key]) => config[key] as string);
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
        entry.staleResources.delete(resourceIdentity(collectionId, resource.id));
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
        entry.staleResources.delete(resourceIdentity(collectionId, id));
        return saved;
      },
      async remove(id: string) {
        const removed = collectionDefinition.persistent === true
          ? markRuntimeResourceRemoved(entry, collectionId, id, await removeSdkResource(userId, instance.id, collectionId, id))
          : removeRuntimeResource(entry, collectionId, id);
        cache.delete(id);
        entry.staleResources.delete(resourceIdentity(collectionId, id));
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
        for (const resource of saved) entry.staleResources.delete(resourceIdentity(collectionId, resource.id));
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
      async assertSafeUrl(input, protocols) {
        return assertSafeIntegrationUrl(input, protocols, undefined, allowedPrivateUrls);
      },
      async fetch(input, init) {
        const controller = new AbortController();
        entry.abortControllers.add(controller);
        const timeout = setTimeout(() => controller.abort(), 15_000);
        const signal = init?.signal
          ? AbortSignal.any([init.signal, controller.signal])
          : controller.signal;
        try { return await guardedIntegrationFetch(input, { ...init, signal }, { allowedPrivateUrls }); }
        finally {
          clearTimeout(timeout);
          entry.abortControllers.delete(controller);
        }
      },
    },
    websocket: {
      async connect(url, protocols) {
        const socket = await createGuardedIntegrationWebSocket(url, protocols, { allowedPrivateUrls });
        entry.sockets.add(socket);
        try {
          await new Promise<void>((resolve, reject) => {
            const onOpen = () => {
              clearTimeout(timeout);
              socket.removeEventListener("error", onError);
              resolve();
            };
            const onError = () => {
              clearTimeout(timeout);
              socket.removeEventListener("open", onOpen);
              reject(new Error("WebSocket connection failed"));
            };
            const timeout = setTimeout(() => {
              socket.removeEventListener("open", onOpen);
              socket.removeEventListener("error", onError);
              try { socket.close(); } catch { /* already closed */ }
              reject(new Error("WebSocket connection timed out"));
            }, 10_000);
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
      debug(message, metadata) {
        const safe = redactSdkIntegrationLog(entry.secretValues, message, metadata);
        logger.debug(`[${instance.id}] ${safe.message}`, safe.metadata);
      },
      info(message, metadata) {
        const safe = redactSdkIntegrationLog(entry.secretValues, message, metadata);
        logger.info(`[${instance.id}] ${safe.message}`, safe.metadata);
      },
      warn(message, metadata) {
        const safe = redactSdkIntegrationLog(entry.secretValues, message, metadata);
        logger.warn(`[${instance.id}] ${safe.message}`, safe.metadata);
      },
      error(message, metadata) {
        const safe = redactSdkIntegrationLog(entry.secretValues, message, metadata);
        logger.error(`[${instance.id}] ${safe.message}`, safe.metadata);
      },
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
  if (!instance.enabled) throw new ApiActionError("Integration instance is disabled", 503, { error: "Integration instance is disabled" });
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
  const rawConfigSchema = contribution.configSchema ?? {};
  const schemaRecord = isObject(rawConfigSchema) ? rawConfigSchema : {};
  const configFields = isObject(schemaRecord.properties)
    ? schemaRecord.properties
    : schemaRecord;
  const configSchema = configFields as IntegrationConfigSchema;
  const requiredConfigKeys = Array.isArray(schemaRecord.required)
    ? schemaRecord.required.filter((key): key is string => typeof key === "string")
    : Object.entries(configSchema)
        .filter(([, field]) => isObject(field) && field.required === true)
        .map(([key]) => key);
  if (Object.keys(rawConfig).some((key) => !(key in configSchema))) {
    throw new ApiActionError("Contribution config contains an unknown field", 400, { error: "Contribution config contains an unknown field" });
  }
  for (const key of requiredConfigKeys) {
    const field = configSchema[key];
    if (rawConfig[key] === undefined && (!isObject(field) || field.default === undefined)) {
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
  if (!entry.running) throw new ApiActionError("Integration instance is not ready", 503, { error: "Integration instance is not ready" });
  const action = Object.values(entry.definition.actions ?? {}).find((candidate) => candidate.id === actionId);
  if (!action) throw new ApiActionError("Action is not declared by this integration", 404, { error: "Action is not declared by this integration" });
  const collection = entry.definition.resources[collectionId];
  if (!collection) throw new ApiActionError("Resource collection not found", 404, { error: "Resource collection not found" });
  const resource = entry.resources[collectionId]?.get(resourceId);
  if (!resource) throw new ApiActionError("Resource not found", 404, { error: "Resource not found" });
  if (entry.staleResources.has(resourceIdentity(collectionId, resourceId))) {
    throw new ApiActionError("Resource state is stale", 409, { error: "Resource state is stale" });
  }
  if (resource.available === false) throw new ApiActionError("Resource is unavailable", 409, { error: "Resource is unavailable" });
  if (!resource.actions?.includes(actionId)) throw new ApiActionError("Action is not available for this resource", 403, { error: "Action is not available for this resource" });
  validateJsonSchema(input, action.inputSchema, "action input");
  const resourceKey = resourceIdentity(collectionId, resourceId);
  if (entry.activeActionResources.has(resourceKey)) {
    throw new ApiActionError("Another action is already running for this resource", 409, { error: "Another action is already running for this resource" });
  }

  entry.activeActionResources.add(resourceKey);
  const controller = new AbortController();
  entry.abortControllers.add(controller);
  let timedOut = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const execution = Promise.resolve().then(() => action.execute(entry.api, resource, input, controller.signal));
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new ApiActionError("Integration action timed out", 504, { error: "Integration action timed out" }));
    }, 30_000);
  });

  try {
    const result = await Promise.race([execution, deadline]);
    assertNoSecrets(entry, result, "action result");
    return result;
  } finally {
    if (timeout) clearTimeout(timeout);
    if (timedOut) {
      // Keep the per-resource lock until non-cooperative handlers actually settle.
      void execution.finally(() => {
        entry.abortControllers.delete(controller);
        entry.activeActionResources.delete(resourceKey);
      }).catch(() => undefined);
    } else {
      controller.abort();
      entry.abortControllers.delete(controller);
      entry.activeActionResources.delete(resourceKey);
    }
  }
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
  entry.staleResources.delete(identity);
  const revision = (entry.revisions.get(identity) ?? 0) + 1;
  entry.revisions.set(identity, revision);
  return true;
}

function removeRuntimeResource(entry: RuntimeEntry, collectionId: string, resourceId: string) {
  const removed = Boolean(entry.resources[collectionId]?.has(resourceId));
  if (!removed) return false;
  const identity = resourceIdentity(collectionId, resourceId);
  entry.staleResources.delete(identity);
  const revision = (entry.revisions.get(identity) ?? 0) + 1;
  entry.revisions.set(identity, revision);
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

export function redactSdkIntegrationLog(
  secrets: readonly string[],
  message: string,
  metadata?: Record<string, JsonValue>,
) {
  return {
    message: redactSecretText(secrets, message),
    metadata: redactLogMetadata(secrets, metadata),
  };
}

function redactSecretText(secrets: readonly string[], value: string) {
  return secrets.reduce(
    (redacted, secret) => secret ? redacted.split(secret).join("[REDACTED]") : redacted,
    value,
  );
}

function redactLogMetadata(
  secrets: readonly string[],
  metadata?: Record<string, JsonValue>,
): Record<string, JsonValue> | undefined {
  if (!metadata) return undefined;
  return Object.fromEntries(Object.entries(metadata).map(([key, value]) => [
    redactSecretText(secrets, key),
    redactLogValue(secrets, value),
  ])) as Record<string, JsonValue>;
}

function redactLogValue(secrets: readonly string[], value: JsonValue): JsonValue {
  if (typeof value === "string") return redactSecretText(secrets, value);
  if (Array.isArray(value)) return value.map((item) => redactLogValue(secrets, item));
  if (value && typeof value === "object") {
    return redactLogMetadata(secrets, value as Record<string, JsonValue>) ?? {};
  }
  return value;
}

function assertNoSecrets(entry: RuntimeEntry, value: unknown, label: string) {
  let serialized = "";
  try { serialized = JSON.stringify(value); } catch { return; }
  if (entry.secretValues.some((secret) => serialized.includes(secret))) {
    throw new ApiActionError(`A ${label} cannot contain configured secrets`, 400, { error: `A ${label} cannot contain configured secrets` });
  }
}
