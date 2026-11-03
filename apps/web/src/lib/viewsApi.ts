import type { ActionAuth } from "@dashwise/types/sdk";
import { authHeaders, backendUrl } from "@/lib/apiClient";

// Saved views contract: Definition = { query: ResourceQuery, presentation?: object }.
// ownerId is always scoped to the authenticated user on the server and is never
// sent by the client.

export type ViewFilterOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "exists";

export type ViewFilter = {
  field: string;
  operator: ViewFilterOperator;
  value?: unknown;
};

export type ViewResourceQuery = {
  types: string[];
  provider: string;
  providerInstanceId: string;
  capabilities: string[];
  filters: ViewFilter[];
  search: string;
  orderBy: "updatedAt" | "createdAt" | "type";
  limit: number;
  offset: number;
};

export type ViewDefinition = {
  query: ViewResourceQuery;
  presentation?: Record<string, unknown>;
};

export type ViewRecord = {
  id: string;
  ownerId: string;
  name: string;
  definition: ViewDefinition;
  createdAt: string;
  updatedAt: string;
};

export type ViewResource = {
  id: string;
  type: string;
  provider: string;
  providerInstanceId?: string;
  providerResourceId: string;
  data: Record<string, unknown>;
  capabilities?: string[];
  state: string;
  createdAt: string;
  updatedAt: string;
};

export type ViewResourcePage = {
  items: ViewResource[];
  total: number;
  limit: number;
  offset: number;
};

export type ViewWriteInput = {
  name: string;
  definition: ViewDefinition;
};

async function viewRequest<T>(
  auth: ActionAuth,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(backendUrl(path), {
    method: init.method ?? "GET",
    headers: {
      ...authHeaders(auth),
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      typeof result?.error === "string" ? result.error : "view request failed",
    ) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return result as T;
}

export async function listViewAction(auth: ActionAuth): Promise<ViewRecord[]> {
  const result = await viewRequest<{ views: ViewRecord[] }>(auth, "/api/v1/views");
  return result.views ?? [];
}

export async function createViewAction(auth: ActionAuth, input: ViewWriteInput): Promise<ViewRecord> {
  const result = await viewRequest<{ view: ViewRecord }>(auth, "/api/v1/views", {
    method: "POST",
    body: input,
  });
  return result.view;
}

export async function updateViewAction(
  auth: ActionAuth,
  viewId: string,
  input: ViewWriteInput,
): Promise<ViewRecord> {
  const result = await viewRequest<{ view: ViewRecord }>(
    auth,
    `/api/v1/views/${encodeURIComponent(viewId)}`,
    { method: "PUT", body: input },
  );
  return result.view;
}

export async function deleteViewAction(auth: ActionAuth, viewId: string): Promise<void> {
  await viewRequest<unknown>(auth, `/api/v1/views/${encodeURIComponent(viewId)}`, {
    method: "DELETE",
  });
}

export async function runViewAction(auth: ActionAuth, viewId: string): Promise<ViewResourcePage> {
  return viewRequest<ViewResourcePage>(
    auth,
    `/api/v1/views/${encodeURIComponent(viewId)}/resources`,
  );
}

/** Builds a human-readable summary of a view query for list display. */
export function describeViewQuery(query: ViewResourceQuery | undefined): string[] {
  if (!query) return [];
  const parts: string[] = [];
  if (query.types?.length) parts.push(query.types.join(", "));
  if (query.provider) parts.push(query.provider);
  if (query.search) parts.push(`"${query.search}"`);
  for (const capability of query.capabilities ?? []) parts.push(capability);
  for (const filter of query.filters ?? []) {
    parts.push(filter.operator === "exists" ? `${filter.field} exists` : `${filter.field} ${filter.operator}`);
  }
  if (query.offset > 0) parts.push(`offset ${query.offset}`);
  if (query.limit && query.limit > 0) parts.push(`limit ${query.limit}`);
  return parts;
}
