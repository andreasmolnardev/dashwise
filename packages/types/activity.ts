import type { JsonValue } from "./sdk-types";

export type ActivitySeverity = "info" | "success" | "warning" | "error";

export type ActivityAction = {
  label: string;
  target: string;
};

/** Data accepted from an authenticated activity producer. Ownership and source are server-resolved. */
export type PublishActivityInput = {
  type: string;
  title: string;
  description?: string;
  severity?: ActivitySeverity;
  eventId?: string;
  idempotencyKey?: string;
  occurredAt?: string;
  metadata?: Record<string, JsonValue>;
  action?: ActivityAction;
};

export type ActivityRecord = {
  id: string;
  ownerId: string;
  source: string;
  sourceId?: string;
  eventId?: string;
  type: string;
  title: string;
  description?: string;
  severity: ActivitySeverity;
  occurredAt: string;
  createdAt: string;
  metadata?: Record<string, JsonValue>;
  action?: ActivityAction;
};

export type ActivityQuery = {
  page?: number;
  perPage?: number;
  source?: string;
  type?: string;
  severity?: ActivitySeverity;
  from?: string;
  to?: string;
};

export type ActivityPage = {
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
  items: ActivityRecord[];
};
