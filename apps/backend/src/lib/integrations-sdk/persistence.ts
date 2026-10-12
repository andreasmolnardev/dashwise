import { ApiActionError } from "../data/auth";
import { decryptSecret, encryptSecret } from "../crypto";
import { getSuperuserPB } from "../pb/pocketbase";
import { broadcastSdkResourceRevision } from "../activity";
import type { ResourceRecord } from "@dashwise/integrations-sdk";

export type SdkResourceRecord = ResourceRecord;

export type SdkInstanceRecord = {
  id: string;
  userId: string;
  name: string;
  source: string;
  type: "sdk";
  enabled: boolean;
  created: string;
  updated: string;
};

type IntegrationRow = Record<string, unknown> & {
  id: string;
  user?: string | { id?: string } | null;
  type?: string;
  source?: string;
  name?: string | null;
  sdkConfig?: string;
  sdkEnabled?: boolean;
  created?: string;
  updated?: string;
};

type ResourceRow = Record<string, unknown> & {
  id: string;
  owner: string;
  instance: string;
  collectionId: string;
  resourceId: string;
  appIds?: unknown;
  data: unknown;
  revision: number;
  stale?: boolean;
  upstreamId?: string;
};

const MAX_JSON_BYTES = 200_000;
const MAX_JSON_DEPTH = 12;
const SDK_STORAGE_ENVELOPE = "dashwise.sdk-storage.v1";

export function encodeSdkConfig(config: Record<string, unknown>) {
  return encryptSecret(config);
}

export function decodeSdkConfig(value: string | null | undefined): Record<string, unknown> {
  const decoded = decryptSecret<unknown>(value);
  return decoded && typeof decoded === "object" && !Array.isArray(decoded)
    ? decoded as Record<string, unknown>
    : {};
}

function encodeSdkStorage(value: unknown) {
  return { format: SDK_STORAGE_ENVELOPE, ciphertext: encryptSecret(value) };
}

function decodeSdkStorage(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const envelope = value as { format?: unknown; ciphertext?: unknown };
    if (envelope.format === SDK_STORAGE_ENVELOPE && typeof envelope.ciphertext === "string") {
      return decryptSecret(envelope.ciphertext);
    }
  }
  // Preserve storage values written by earlier SDK builds. The next write
  // upgrades them to the encrypted envelope above.
  return value;
}

export async function createSdkInstance(
  userId: string,
  input: { source: string; name?: string; config: Record<string, unknown> },
): Promise<SdkInstanceRecord> {
  const source = validateIdentifier(input.source, "integration id", 120);
  const name = String(input.name ?? "").trim().slice(0, 120) || source;
  validateJsonValue(input.config);
  const pb = await getSuperuserPB();
  const row = await pb.collection("integrations").create({
    type: "sdk",
    source,
    name,
    user: userId,
    sdkConfig: encodeSdkConfig(input.config),
    sdkEnabled: true,
    environment: {},
  }) as IntegrationRow;
  return mapInstance(row, userId);
}

export async function listSdkInstances(userId: string): Promise<SdkInstanceRecord[]> {
  const pb = await getSuperuserPB();
  const rows = await pb.collection("integrations").getFullList<IntegrationRow>({
    filter: `user = "${escapeFilter(userId)}" && type = "sdk"`,
    sort: "-updated",
  });
  return rows.map((row) => mapInstance(row, userId));
}

export async function listAllSdkInstancesForRuntime() {
  const pb = await getSuperuserPB();
  const rows = await pb.collection("integrations").getFullList<IntegrationRow>({
    filter: `type = "sdk" && sdkEnabled = true`,
    sort: "created",
  });
  return rows.map((row) => mapInstance(row, relationId(row.user)));
}

export async function getOwnedSdkInstance(userId: string, instanceId: string) {
  const pb = await getSuperuserPB();
  const row = await pb.collection("integrations").getOne<IntegrationRow>(instanceId).catch(() => null);
  if (!row || relationId(row.user) !== userId || row.type !== "sdk") {
    throw new ApiActionError("Integration instance not found", 404, { error: "Integration instance not found" });
  }
  return { pb, row, instance: mapInstance(row, userId) };
}

export async function updateSdkInstance(
  userId: string,
  instanceId: string,
  update: { name?: string; config?: Record<string, unknown>; enabled?: boolean },
) {
  const { pb } = await getOwnedSdkInstance(userId, instanceId);
  const body: Record<string, unknown> = {};
  if (update.name !== undefined) body.name = String(update.name).trim().slice(0, 120);
  if (update.enabled !== undefined) body.sdkEnabled = update.enabled;
  if (update.config !== undefined) {
    validateJsonValue(update.config);
    body.sdkConfig = encodeSdkConfig(update.config);
  }
  if (Object.keys(body).length === 0) return { instance: (await getOwnedSdkInstance(userId, instanceId)).instance };
  const row = await pb.collection("integrations").update<IntegrationRow>(instanceId, body);
  return { instance: mapInstance(row, userId) };
}

export async function deleteSdkInstance(userId: string, instanceId: string) {
  const { pb } = await getOwnedSdkInstance(userId, instanceId);
  const resources = await pb.collection("sdkIntegrationResources").getFullList<ResourceRow>({
    filter: `owner = "${escapeFilter(userId)}" && instance = "${escapeFilter(instanceId)}"`,
    fields: "collectionId,resourceId,revision",
  });
  for (const resource of resources) {
    broadcastSdkResourceRevision(userId, {
      instanceId,
      collectionId: resource.collectionId,
      resourceId: resource.resourceId,
      revision: Number(resource.revision ?? 0) + 1,
      operation: "remove",
    });
  }
  const apps = await pb.collection("shortcutsApps").getFullList({
    filter: `user = "${escapeFilter(userId)}"`,
    fields: "id,sourceId",
  });
  const appPrefix = `sdk:${instanceId}:`;
  await Promise.all(apps.filter((app) => String(app.sourceId ?? "").startsWith(appPrefix))
    .map((app) => pb.collection("shortcutsApps").delete(app.id)));
  await pb.collection("integrations").delete(instanceId);
  return { success: true };
}

export async function getSdkInstanceConfig(userId: string, instanceId: string) {
  const { row } = await getOwnedSdkInstance(userId, instanceId);
  return decodeSdkConfig(row.sdkConfig);
}

export async function listSdkResources(userId: string, instanceId: string, collectionId?: string) {
  const { pb } = await getOwnedSdkInstance(userId, instanceId);
  const clauses = [`owner = "${escapeFilter(userId)}"`, `instance = "${escapeFilter(instanceId)}"`];
  if (collectionId) clauses.push(`collectionId = "${escapeFilter(collectionId)}"`);
  const rows = await pb.collection("sdkIntegrationResources").getFullList<ResourceRow>({
    filter: clauses.join(" && "),
    sort: "collectionId,resourceId",
  });
  return rows.map(mapResourceRow);
}

export async function getSdkStorage(userId: string, instanceId: string, key: string) {
  const { pb } = await getOwnedSdkInstance(userId, instanceId);
  const row = await pb.collection("sdkIntegrationStorage").getFirstListItem(
    `owner = "${escapeFilter(userId)}" && instance = "${escapeFilter(instanceId)}" && key = "${escapeFilter(validateIdentifier(key, "storage key", 200))}"`,
  ).catch(() => null);
  return row?.value == null ? null : decodeSdkStorage(row.value);
}

export async function setSdkStorage(userId: string, instanceId: string, key: string, value: unknown) {
  validateIdentifier(key, "storage key", 200);
  validateJsonValue(value);
  const { pb } = await getOwnedSdkInstance(userId, instanceId);
  const filter = `owner = "${escapeFilter(userId)}" && instance = "${escapeFilter(instanceId)}" && key = "${escapeFilter(key)}"`;
  const existing = await pb.collection("sdkIntegrationStorage").getFirstListItem(filter).catch(() => null);
  const storedValue = encodeSdkStorage(value);
  if (existing) return pb.collection("sdkIntegrationStorage").update(existing.id, { value: storedValue });
  return pb.collection("sdkIntegrationStorage").create({ owner: userId, instance: instanceId, key, value: storedValue });
}

export async function removeSdkStorage(userId: string, instanceId: string, key: string) {
  validateIdentifier(key, "storage key", 200);
  const { pb } = await getOwnedSdkInstance(userId, instanceId);
  const row = await pb.collection("sdkIntegrationStorage").getFirstListItem(
    `owner = "${escapeFilter(userId)}" && instance = "${escapeFilter(instanceId)}" && key = "${escapeFilter(key)}"`,
  ).catch(() => null);
  if (row) await pb.collection("sdkIntegrationStorage").delete(row.id);
}

export async function upsertSdkResource(
  userId: string,
  instanceId: string,
  collectionId: string,
  resource: SdkResourceRecord,
) {
  validateResource(resource);
  const { pb } = await getOwnedSdkInstance(userId, instanceId);
  const filter = resourceFilter(userId, instanceId, collectionId, resource.id);
  const existing = await pb.collection("sdkIntegrationResources").getFirstListItem<ResourceRow>(filter).catch(() => null);
  const data = resourceToJson(resource);
  if (existing && stableJson(existing.data) === stableJson(data) && !existing.stale) {
    return { resource: mapResourceRow(existing), changed: false };
  }
  const revision = (existing?.revision ?? 0) + 1;
  const record = {
    owner: userId,
    instance: instanceId,
    collectionId,
    resourceId: resource.id,
    appIds: resource.apps,
    data,
    revision,
    stale: false,
    ...(resource.upstreamId ? { upstreamId: resource.upstreamId } : {}),
  };
  const row = existing
    ? await pb.collection("sdkIntegrationResources").update<ResourceRow>(existing.id, record)
    : await pb.collection("sdkIntegrationResources").create<ResourceRow>(record);
  broadcastSdkResourceRevision(userId, {
    instanceId,
    collectionId,
    resourceId: resource.id,
    revision,
    operation: "upsert",
  });
  return { resource: mapResourceRow(row), changed: true };
}

export async function removeSdkResource(userId: string, instanceId: string, collectionId: string, resourceId: string) {
  const { pb } = await getOwnedSdkInstance(userId, instanceId);
  const row = await pb.collection("sdkIntegrationResources").getFirstListItem<ResourceRow>(
    resourceFilter(userId, instanceId, collectionId, resourceId),
  ).catch(() => null);
  if (row) {
    await pb.collection("sdkIntegrationResources").delete(row.id);
    broadcastSdkResourceRevision(userId, {
      instanceId,
      collectionId,
      resourceId,
      revision: Number(row.revision ?? 0) + 1,
      operation: "remove",
    });
  }
  return Boolean(row);
}

export async function syncSdkResources(
  userId: string,
  instanceId: string,
  collectionId: string,
  resources: SdkResourceRecord[],
  completeness: "complete" | "partial",
) {
  validateIdentifier(collectionId, "collection id", 120);
  if (!Array.isArray(resources)) throw new ApiActionError("Resources must be an array", 400, { error: "Resources must be an array" });
  const ids = new Set<string>();
  for (const resource of resources) {
    validateResource(resource);
    if (ids.has(resource.id)) throw new ApiActionError("Duplicate resource id", 400, { error: "Duplicate resource id" });
    ids.add(resource.id);
  }
  const saved = [];
  for (const resource of resources) saved.push(await upsertSdkResource(userId, instanceId, collectionId, resource));
  let removed = 0;
  if (completeness === "complete") {
    const current = await listSdkResources(userId, instanceId, collectionId);
    for (const resource of current) {
      if (!ids.has(resource.id) && await removeSdkResource(userId, instanceId, collectionId, resource.id)) removed++;
    }
  }
  return { resources: saved.map((entry) => entry.resource), changed: saved.some((entry) => entry.changed) || removed > 0, removed };
}

export async function markSdkResourcesStale(userId: string, instanceId: string) {
  const { pb } = await getOwnedSdkInstance(userId, instanceId);
  const rows = await pb.collection("sdkIntegrationResources").getFullList<ResourceRow>({
    filter: `owner = "${escapeFilter(userId)}" && instance = "${escapeFilter(instanceId)}" && stale = false`,
    fields: "id,stale",
  });
  await Promise.all(rows.map((row) => pb.collection("sdkIntegrationResources").update(row.id, { stale: true })));
}

export function escapeFilter(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function mapInstance(row: IntegrationRow, userId: string): SdkInstanceRecord {
  return {
    id: row.id,
    userId,
    name: String(row.name ?? row.source ?? "Integration"),
    source: String(row.source ?? ""),
    type: "sdk",
    enabled: row.sdkEnabled !== false,
    created: String(row.created ?? ""),
    updated: String(row.updated ?? ""),
  };
}

function mapResourceRow(row: ResourceRow): SdkResourceRecord & { collectionId: string; revision: number; stale: boolean } {
  const data = isObject(row.data) ? row.data : {};
  return {
    ...data,
    id: row.resourceId,
    apps: Array.isArray(row.appIds) ? row.appIds.filter((value): value is string => typeof value === "string") : [],
    collectionId: row.collectionId,
    revision: Number(row.revision ?? 0),
    stale: row.stale === true,
    ...(typeof row.upstreamId === "string" && row.upstreamId ? { upstreamId: row.upstreamId } : {}),
  } as unknown as SdkResourceRecord & { collectionId: string; revision: number; stale: boolean };
}

function resourceToJson(resource: SdkResourceRecord) {
  return {
    id: resource.id,
    name: resource.name,
    ...(resource.icon ? { icon: resource.icon } : {}),
    ...(resource.type ? { type: resource.type } : {}),
    ...(resource.tags?.length ? { tags: resource.tags } : {}),
    ...(resource.state ? { state: resource.state } : {}),
    ...(resource.attributes ? { attributes: resource.attributes } : {}),
    ...(resource.available !== undefined ? { available: resource.available } : {}),
    ...(resource.actions?.length ? { actions: resource.actions } : {}),
    ...(resource.apps ? { apps: resource.apps } : {}),
    ...(resource.updatedAt ? { updatedAt: resource.updatedAt } : {}),
    ...(resource.upstreamId ? { upstreamId: resource.upstreamId } : {}),
  };
}

function validateResource(resource: SdkResourceRecord) {
  if (!isObject(resource)) throw new ApiActionError("Invalid resource", 400, { error: "Invalid resource" });
  validateIdentifier(resource.id, "resource id", 200);
  if (typeof resource.name !== "string" || !resource.name.trim() || resource.name.length > 240) {
    throw new ApiActionError("Invalid resource name", 400, { error: "Invalid resource name" });
  }
  if (resource.apps !== undefined && (!Array.isArray(resource.apps) || resource.apps.some((app) => typeof app !== "string" || !app.trim()))) {
    throw new ApiActionError("Invalid resource App membership", 400, { error: "Invalid resource App membership" });
  }
  if (resource.updatedAt && !Number.isFinite(Date.parse(resource.updatedAt))) {
    throw new ApiActionError("Invalid resource update time", 400, { error: "Invalid resource update time" });
  }
  validateJsonValue(resourceToJson(resource));
}

function validateJsonValue(value: unknown) {
  let serialized: string;
  try { serialized = JSON.stringify(value); } catch { throw new ApiActionError("Value must be JSON serializable", 400, { error: "Value must be JSON serializable" }); }
  if (Buffer.byteLength(serialized, "utf8") > MAX_JSON_BYTES || jsonDepth(value) > MAX_JSON_DEPTH) {
    throw new ApiActionError("JSON value exceeds storage limits", 400, { error: "JSON value exceeds storage limits" });
  }
}

function jsonDepth(value: unknown): number {
  if (Array.isArray(value)) return 1 + Math.max(0, ...value.map(jsonDepth));
  if (!isObject(value)) return 0;
  return 1 + Math.max(0, ...Object.values(value).map(jsonDepth));
}

function validateIdentifier(value: unknown, label: string, maxLength: number) {
  // eslint-disable-next-line no-control-regex
  if (typeof value !== "string" || !value.trim() || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new ApiActionError(`Invalid ${label}`, 400, { error: `Invalid ${label}` });
  }
  return value.trim();
}

function resourceFilter(userId: string, instanceId: string, collectionId: string, resourceId: string) {
  return `owner = "${escapeFilter(userId)}" && instance = "${escapeFilter(instanceId)}" && collectionId = "${escapeFilter(collectionId)}" && resourceId = "${escapeFilter(resourceId)}"`;
}

function relationId(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value && typeof value.id === "string") return value.id;
  return "";
}

function stableJson(value: unknown) {
  return JSON.stringify(value, (_key, child) => {
    if (!child || typeof child !== "object" || Array.isArray(child)) return child;
    return Object.fromEntries(Object.entries(child).sort(([left], [right]) => left.localeCompare(right)));
  });
}

function isObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
