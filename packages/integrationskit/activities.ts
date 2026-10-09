import type { ActivityRecord, PublishActivityInput } from "@dashwise/types";

const MAX_REQUEST_BYTES = 100 * 1024;
const MAX_METADATA_BYTES = 16 * 1024;
const MAX_METADATA_DEPTH = 8;
const SEVERITIES = new Set(["info", "success", "warning", "error"]);
const ALLOWED_FIELDS = new Set([
  "type",
  "title",
  "description",
  "severity",
  "eventId",
  "idempotencyKey",
  "occurredAt",
  "metadata",
  "action",
]);

export type PublishActivityResult = {
  activity: ActivityRecord;
  duplicate: boolean;
};

export type ActivityPublisherOptions = {
  /** Dashwise backend origin, with or without a trailing `/api/v1`. */
  baseUrl: string;
  /** The integration record whose ownership the authenticated user controls. */
  integrationId: string;
  /** Dashwise user session token. The backend verifies that this user owns the integration. */
  token: string | (() => string | Promise<string>);
  fetch?: typeof fetch;
};

export class ActivityPublishError extends Error {
  readonly status?: number;
  readonly responseBody?: unknown;
  readonly cause?: unknown;

  constructor(message: string, options: { status?: number; responseBody?: unknown; cause?: unknown } = {}) {
    super(message);
    this.name = "ActivityPublishError";
    this.status = options.status;
    this.responseBody = options.responseBody;
    this.cause = options.cause;
  }
}

/**
 * Creates an integration-scoped activity publisher. Source and owner are resolved
 * by Dashwise from the authenticated user and integration record; they are never
 * accepted from the activity payload.
 */
export function createActivityPublisher(options: ActivityPublisherOptions) {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const integrationId = options.integrationId.trim();
  if (!integrationId) throw new ActivityPublishError("An integration ID is required");

  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new ActivityPublishError("A Fetch API implementation is required");

  return {
    async publish(input: PublishActivityInput): Promise<PublishActivityResult> {
      const validated = validatePublishActivityInput(input);
      const token = (typeof options.token === "function" ? await options.token() : options.token).trim();
      if (!token) throw new ActivityPublishError("A Dashwise session token is required");

      const url = `${baseUrl}/api/v1/integrations/${encodeURIComponent(integrationId)}/activities`;
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(validated),
        });
      } catch (cause) {
        throw new ActivityPublishError("Unable to reach the Dashwise activity API", { cause });
      }

      const body = await readResponseBody(response);
      if (!response.ok) {
        const message = getErrorMessage(body) ?? `Activity publishing failed with status ${response.status}`;
        throw new ActivityPublishError(message, { status: response.status, responseBody: body });
      }

      if (!isPublishActivityResult(body)) {
        throw new ActivityPublishError("The Dashwise activity API returned an invalid response", {
          status: response.status,
          responseBody: body,
        });
      }
      return body;
    },
  };
}

/** Validate activity payloads locally using the same limits as the backend. */
export function validatePublishActivityInput(value: unknown): PublishActivityInput {
  if (!isPlainObject(value)) throw new ActivityPublishError("Activity payload must be an object");
  if (Object.keys(value).some((key) => !ALLOWED_FIELDS.has(key))) {
    throw new ActivityPublishError("Activity payload contains unsupported fields");
  }

  const type = requiredString(value.type, "type", 120);
  const title = requiredString(value.title, "title", 200);
  const description = optionalString(value.description, "description", 2_000);
  const severity = value.severity;
  if (severity !== undefined && (typeof severity !== "string" || !SEVERITIES.has(severity))) {
    throw new ActivityPublishError("Activity severity must be info, success, warning, or error");
  }
  const eventId = optionalString(value.eventId, "eventId", 200);
  const idempotencyKey = optionalString(value.idempotencyKey, "idempotencyKey", 256);
  const occurredAt = optionalString(value.occurredAt, "occurredAt", 64);
  if (occurredAt && (!/(?:Z|[+-]\d{2}:\d{2})$/.test(occurredAt) || !Number.isFinite(Date.parse(occurredAt)))) {
    throw new ActivityPublishError("Activity occurredAt must be a valid ISO date with a timezone");
  }

  let metadata: Record<string, unknown> | undefined;
  if (value.metadata !== undefined) {
    if (!isPlainObject(value.metadata)) throw new ActivityPublishError("Activity metadata must be an object");
    if (!isJsonValue(value.metadata)) throw new ActivityPublishError("Activity metadata must contain only JSON values");
    if (byteLength(JSON.stringify(value.metadata)) > MAX_METADATA_BYTES) {
      throw new ActivityPublishError("Activity metadata exceeds the 16 KB limit");
    }
    if (hasExcessiveDepth(value.metadata, 0)) {
      throw new ActivityPublishError("Activity metadata nesting exceeds the limit");
    }
    if (hasSensitiveMetadataKey(value.metadata)) {
      throw new ActivityPublishError("Activity metadata must not contain credentials or secrets");
    }
    metadata = value.metadata as Record<string, unknown>;
  }

  let action: PublishActivityInput["action"];
  if (value.action !== undefined) {
    if (!isPlainObject(value.action) || Object.keys(value.action).some((key) => key !== "label" && key !== "target")) {
      throw new ActivityPublishError("Activity action must contain only a label and target");
    }
    const label = requiredString(value.action.label, "action.label", 80);
    const target = requiredString(value.action.target, "action.target", 2_048);
    if (!isSafeInternalTarget(target)) {
      throw new ActivityPublishError("Activity actions must target a safe internal path");
    }
    action = { label, target };
  }

  const normalized: PublishActivityInput = {
    type,
    title,
    ...(description !== undefined ? { description } : {}),
    ...(severity !== undefined ? { severity: severity as PublishActivityInput["severity"] } : {}),
    ...(eventId !== undefined ? { eventId } : {}),
    ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
    ...(occurredAt !== undefined ? { occurredAt } : {}),
    ...(metadata !== undefined ? { metadata: metadata as PublishActivityInput["metadata"] } : {}),
    ...(action !== undefined ? { action } : {}),
  };

  if (byteLength(JSON.stringify(normalized)) > MAX_REQUEST_BYTES) {
    throw new ActivityPublishError("Activity payload exceeds the 100 KB limit");
  }
  return normalized;
}

function normalizeBaseUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "").replace(/\/api\/v1$/i, "");
  if (!/^https?:\/\//i.test(trimmed)) throw new ActivityPublishError("baseUrl must be an absolute HTTP(S) URL");
  try {
    const parsed = new URL(trimmed);
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error("Invalid URL components");
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    throw new ActivityPublishError("baseUrl must be an absolute HTTP(S) URL");
  }
}

function requiredString(value: unknown, name: string, maxLength: number) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new ActivityPublishError(`${name} must be a non-empty string up to ${maxLength} characters`);
  }
  return value.trim();
}

function optionalString(value: unknown, name: string, maxLength: number) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length > maxLength) {
    throw new ActivityPublishError(`${name} must be a string up to ${maxLength} characters`);
  }
  const trimmed = value.trim();
  if (!trimmed && ["eventId", "idempotencyKey", "occurredAt"].includes(name)) {
    throw new ActivityPublishError(`${name} must not be empty`);
  }
  return trimmed;
}

function isPlainObject(value: unknown): value is Record<string, any> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isJsonValue(value: unknown): value is null | string | number | boolean | unknown[] | Record<string, unknown> {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (isPlainObject(value)) return Object.values(value).every(isJsonValue);
  return false;
}

function hasExcessiveDepth(value: unknown, depth: number): boolean {
  if (depth > MAX_METADATA_DEPTH) return true;
  if (Array.isArray(value)) return value.some((item) => hasExcessiveDepth(item, depth + 1));
  if (!isPlainObject(value)) return false;
  return Object.values(value).some((item) => hasExcessiveDepth(item, depth + 1));
}

function hasSensitiveMetadataKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasSensitiveMetadataKey);
  if (!isPlainObject(value)) return false;
  return Object.entries(value).some(([key, item]) =>
    /(^|[_-])(password|passwd|secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key|auth|authorization|credential|private[_-]?key)([_-]|$)/i.test(key.replace(/([a-z0-9])([A-Z])/g, "$1_$2")) || hasSensitiveMetadataKey(item),
  );
}

function isSafeInternalTarget(target: string) {
  if (!target.startsWith("/") || target.startsWith("//") || target.includes("\\") || hasControlCharacters(target)) return false;
  try {
    const parsed = new URL(target, "https://dashwise.invalid");
    return parsed.origin === "https://dashwise.invalid" && parsed.pathname.startsWith("/");
  } catch {
    return false;
  }
}

function hasControlCharacters(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

async function readResponseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function getErrorMessage(body: unknown) {
  return isPlainObject(body) && typeof body.error === "string" ? body.error : undefined;
}

function isPublishActivityResult(value: unknown): value is PublishActivityResult {
  if (!isPlainObject(value) || !isPlainObject(value.activity) || typeof value.duplicate !== "boolean") return false;
  return typeof value.activity.id === "string" && typeof value.activity.ownerId === "string";
}
