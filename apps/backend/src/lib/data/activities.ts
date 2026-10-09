import { z } from "zod";

import type {
  ActivityPage,
  ActivityQuery,
  ActivityRecord,
  PublishActivityInput,
} from "@dashwise/types";
import type { JsonValue } from "@dashwise/types/sdk";
import { ApiActionError } from "./auth";
import { getSuperuserPB } from "../pb/pocketbase";
import { broadcastActivity } from "../activity";

const SEVERITIES = ["info", "success", "warning", "error"] as const;
const MAX_REQUEST_BYTES = 100 * 1024;
const MAX_METADATA_BYTES = 16 * 1024;
const MAX_METADATA_DEPTH = 8;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const PUBLISH_RATE_WINDOW_MS = 60_000;
const PUBLISH_RATE_LIMIT = 120;
const publishRateWindows = new Map<string, { startedAt: number; count: number }>();
const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(jsonValueSchema),
  z.record(z.string(), jsonValueSchema),
]));

const activityInputSchema = z.object({
  type: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2_000).optional(),
  severity: z.enum(SEVERITIES).optional().default("info"),
  eventId: z.string().trim().min(1).max(200).optional(),
  idempotencyKey: z.string().trim().min(1).max(256).optional(),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  metadata: z.record(z.string(), jsonValueSchema).optional(),
  action: z.object({
    label: z.string().trim().min(1).max(80),
    target: z.string().trim().min(1).max(2_048),
  }).strict().optional(),
}).strict();

type ActivityRow = Record<string, unknown> & {
  id: string;
  owner: string;
  source: string;
  sourceId?: string;
  eventId?: string;
  type: string;
  title: string;
  description?: string;
  severity: ActivityRecord["severity"];
  occurredAt: string;
  createdAt?: string;
  created?: string;
};

export class ActivityInputError extends ApiActionError {
  constructor(message: string) {
    super(message, 400, { error: message });
    this.name = "ActivityInputError";
  }
}

export function validatePublishActivityInput(value: unknown): PublishActivityInput {
  const parsed = activityInputSchema.safeParse(value);
  if (!parsed.success) {
    throw new ActivityInputError("Invalid activity payload");
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(parsed.data);
  } catch {
    throw new ActivityInputError("Invalid activity payload");
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_REQUEST_BYTES) {
    throw new ActivityInputError("Activity payload exceeds the 100 KB limit");
  }

  if (parsed.data.metadata) {
    const metadataJSON = JSON.stringify(parsed.data.metadata);
    if (Buffer.byteLength(metadataJSON, "utf8") > MAX_METADATA_BYTES) {
      throw new ActivityInputError("Activity metadata exceeds the 16 KB limit");
    }
    if (hasExcessiveDepth(parsed.data.metadata, 0)) {
      throw new ActivityInputError("Activity metadata nesting exceeds the limit");
    }
    if (hasSensitiveMetadataKey(parsed.data.metadata)) {
      throw new ActivityInputError("Activity metadata must not contain credentials or secrets");
    }
  }

  if (parsed.data.action && !isSafeInternalTarget(parsed.data.action.target)) {
    throw new ActivityInputError("Activity actions must target a safe internal path");
  }

  return {
    ...parsed.data,
    ...(parsed.data.description ? { description: parsed.data.description } : {}),
  };
}

export function validateActivityQuery(query: Record<string, unknown>): ActivityQuery {
  const page = parseIntegerQuery(query.page, 1, 1_000_000);
  const perPage = parseIntegerQuery(query.perPage, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const severity = typeof query.severity === "string" ? query.severity : undefined;
  if (severity && !SEVERITIES.includes(severity as typeof SEVERITIES[number])) {
    throw new ActivityInputError("Invalid severity filter");
  }

  const from = parseOptionalDate(query.from, "from");
  const to = parseOptionalDate(query.to, "to");
  if (from && to && Date.parse(from) > Date.parse(to)) {
    throw new ActivityInputError("The from filter must be earlier than or equal to to");
  }

  return {
    page,
    perPage,
    ...(optionalFilter(query.source, "source") ? { source: optionalFilter(query.source, "source") } : {}),
    ...(optionalFilter(query.type, "type") ? { type: optionalFilter(query.type, "type") } : {}),
    ...(severity ? { severity: severity as ActivityQuery["severity"] } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };
}

export async function publishIntegrationActivity(
  userId: string,
  integrationId: string,
  untrustedInput: unknown,
) {
  const pb = await getSuperuserPB();
  const integration = await pb.collection("integrations").getOne(integrationId).catch(() => null);
  if (!integration || relationId(integration.user) !== userId) {
    throw new ApiActionError("Integration not found", 404, { error: "Integration not found" });
  }

  const sourceId = integration.id;
  const rawSource = typeof integration.source === "string" ? integration.source.trim() : "";
  const source = rawSource.slice(0, 120) || "integration";
  return publishActivity(userId, source, untrustedInput, sourceId);
}

/** Publish a validated activity for a trusted server-side producer. */
export async function publishActivity(
  userId: string,
  source: string,
  untrustedInput: unknown,
  sourceId?: string,
) {
  const input = validatePublishActivityInput(untrustedInput);
  enforcePublishRateLimit(userId);
  const normalizedSource = source.trim().slice(0, 120);
  if (!normalizedSource) throw new ActivityInputError("Activity source is required");
  const normalizedSourceId = sourceId?.trim().slice(0, 200);
  const pb = await getSuperuserPB();
  const rawKey = input.idempotencyKey ?? input.eventId;
  const idempotencyKey = rawKey;

  if (idempotencyKey) {
    const existing = await findDuplicate(pb, userId, normalizedSource, normalizedSourceId ?? "", idempotencyKey);
    if (existing) return { activity: mapActivity(existing), duplicate: true };
  }

  const payload = {
    owner: userId,
    source: normalizedSource,
    ...(normalizedSourceId ? { sourceId: normalizedSourceId } : {}),
    ...(input.eventId ? { eventId: input.eventId } : {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
    type: input.type,
    title: input.title,
    ...(input.description ? { description: input.description } : {}),
    severity: input.severity ?? "info",
    occurredAt: input.occurredAt ? new Date(input.occurredAt).toISOString() : new Date().toISOString(),
    ...(input.metadata ? { metadata: input.metadata } : {}),
    ...(input.action ? { action: input.action } : {}),
  };

  try {
    const created = await pb.collection("activities").create(payload) as ActivityRow;
    broadcastActivity(userId);
    return { activity: mapActivity(created), duplicate: false };
  } catch (error) {
    if (idempotencyKey) {
      const existing = await findDuplicate(pb, userId, normalizedSource, normalizedSourceId ?? "", idempotencyKey);
      if (existing) return { activity: mapActivity(existing), duplicate: true };
    }
    throw error;
  }
}

export async function listActivities(userId: string, query: ActivityQuery = {}): Promise<ActivityPage> {
  const pb = await getSuperuserPB();
  const page = query.page ?? 1;
  const perPage = Math.min(query.perPage ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const clauses = [`owner = ${filterString(userId)}`];
  if (query.source) clauses.push(`source = ${filterString(query.source)}`);
  if (query.type) clauses.push(`type = ${filterString(query.type)}`);
  if (query.severity) clauses.push(`severity = ${filterString(query.severity)}`);
  if (query.from) clauses.push(`occurredAt >= ${filterString(query.from)}`);
  if (query.to) clauses.push(`occurredAt <= ${filterString(query.to)}`);

  const result = await pb.collection("activities").getList<ActivityRow>(page, perPage, {
    filter: clauses.join(" && "),
    sort: "-occurredAt,-createdAt",
  });

  return {
    page: result.page,
    perPage: result.perPage,
    totalItems: result.totalItems,
    totalPages: result.totalPages,
    items: result.items.map(mapActivity),
  };
}

export async function getActivity(userId: string, activityId: string) {
  const pb = await getSuperuserPB();
  const record = await pb.collection("activities").getOne<ActivityRow>(activityId).catch(() => null);
  if (!record || record.owner !== userId) return null;
  return mapActivity(record);
}

export async function deleteActivity(userId: string, activityId: string) {
  const pb = await getSuperuserPB();
  const record = await pb.collection("activities").getOne<ActivityRow>(activityId).catch(() => null);
  if (!record || record.owner !== userId) return false;
  await pb.collection("activities").delete(activityId);
  broadcastActivity(userId);
  return true;
}

export async function deleteExpiredActivities(retentionDays: number) {
  const days = Number.isInteger(retentionDays) ? Math.max(1, Math.min(retentionDays, 3_650)) : 90;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const pb = await getSuperuserPB();
  const affectedOwners = new Set<string>();
  let deleted = 0;
  while (true) {
    const expired = await pb.collection("activities").getList<ActivityRow>(1, 500, {
      filter: `occurredAt < ${filterString(cutoff)}`,
      fields: "id,owner",
      sort: "occurredAt",
    });
    if (expired.items.length === 0) break;
    for (const record of expired.items) affectedOwners.add(record.owner);
    const results = await Promise.allSettled(expired.items.map((record) => pb.collection("activities").delete(record.id)));
    deleted += results.filter((result) => result.status === "fulfilled").length;
    if (results.every((result) => result.status === "rejected")) break;
  }
  for (const ownerId of affectedOwners) broadcastActivity(ownerId);
  return { deleted };
}

function mapActivity(row: ActivityRow): ActivityRecord {
  const metadata = asObject(row.metadata);
  const action = asObject(row.action);
  return {
    id: row.id,
    ownerId: row.owner,
    source: row.source,
    ...(typeof row.sourceId === "string" && row.sourceId ? { sourceId: row.sourceId } : {}),
    ...(typeof row.eventId === "string" && row.eventId ? { eventId: row.eventId } : {}),
    type: row.type,
    title: row.title,
    ...(typeof row.description === "string" && row.description ? { description: row.description } : {}),
    severity: SEVERITIES.includes(row.severity) ? row.severity : "info",
    occurredAt: row.occurredAt,
    createdAt: typeof row.createdAt === "string" ? row.createdAt : (row.created ?? row.occurredAt),
    ...(metadata ? { metadata: metadata as ActivityRecord["metadata"] } : {}),
    ...(action && typeof action.label === "string" && typeof action.target === "string"
      ? { action: { label: action.label, target: action.target } }
      : {}),
  };
}

async function findDuplicate(
  pb: Awaited<ReturnType<typeof getSuperuserPB>>,
  userId: string,
  source: string,
  sourceId: string,
  idempotencyKey: string,
) {
  return await pb.collection("activities").getFirstListItem<ActivityRow>(
    `owner = ${filterString(userId)} && source = ${filterString(source)} && sourceId = ${filterString(sourceId)} && idempotencyKey = ${filterString(idempotencyKey)}`,
  ).catch(() => null);
}

function filterString(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}

function relationId(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value && typeof value.id === "string") return value.id;
  return "";
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return null; }
  }
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasExcessiveDepth(value: unknown, depth: number): boolean {
  if (depth > MAX_METADATA_DEPTH) return true;
  if (Array.isArray(value)) return value.some((item) => hasExcessiveDepth(item, depth + 1));
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value).some((item) => hasExcessiveDepth(item, depth + 1));
}

function hasSensitiveMetadataKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasSensitiveMetadataKey);
  if (typeof value !== "object" || value === null) return false;
  return Object.entries(value).some(([key, item]) =>
    /(^|[_-])(password|passwd|secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key|auth|authorization|credential|private[_-]?key)([_-]|$)/i.test(key.replace(/([a-z0-9])([A-Z])/g, "$1_$2")) || hasSensitiveMetadataKey(item)
  );
}

function enforcePublishRateLimit(userId: string) {
  const now = Date.now();
  for (const [key, window] of publishRateWindows) {
    if (now - window.startedAt >= PUBLISH_RATE_WINDOW_MS) publishRateWindows.delete(key);
  }
  const window = publishRateWindows.get(userId);
  if (!window || now - window.startedAt >= PUBLISH_RATE_WINDOW_MS) {
    if (publishRateWindows.size >= 10_000) publishRateWindows.clear();
    publishRateWindows.set(userId, { startedAt: now, count: 1 });
    return;
  }
  if (window.count >= PUBLISH_RATE_LIMIT) {
    throw new ApiActionError("Activity publish rate limit exceeded", 429, { error: "Activity publish rate limit exceeded" });
  }
  window.count += 1;
}

function isSafeInternalTarget(target: string) {
  if (!target.startsWith("/") || target.startsWith("//") || target.includes("\\") || /[\u0000-\u001f\u007f]/.test(target)) return false;
  try {
    const parsed = new URL(target, "https://dashwise.invalid");
    return parsed.origin === "https://dashwise.invalid" && parsed.pathname.startsWith("/");
  } catch {
    return false;
  }
}

function parseIntegerQuery(value: unknown, defaultValue: number, max: number) {
  if (value === undefined || value === "") return defaultValue;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) throw new ActivityInputError("Invalid pagination parameters");
  return parsed;
}

function optionalFilter(value: unknown, name: string) {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 120) {
    throw new ActivityInputError(`Invalid ${name} filter`);
  }
  return value.trim();
}

function parseOptionalDate(value: unknown, name: string) {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new ActivityInputError(`Invalid ${name} date filter`);
  }
  return new Date(value).toISOString();
}
