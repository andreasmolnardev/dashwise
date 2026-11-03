import type { ActionAuth } from "@dashwise/types/sdk";
import { authHeaders, backendUrl } from "@/lib/apiClient";

export type MigrationArchiveImportResult = {
  imported: Record<string, number>;
  skipped?: string[];
};

async function readError(response: Response, fallback: string): Promise<Error> {
  const body = await response.json().catch(() => ({}));
  const error = new Error(typeof body?.error === "string" ? body.error : fallback) as Error & { status?: number; body?: unknown };
  error.status = response.status;
  error.body = body;
  return error;
}

export async function exportMigrationArchiveAction(auth: ActionAuth): Promise<Blob> {
  const response = await fetch(backendUrl("/api/v1/migration/export"), { headers: authHeaders(auth) });
  if (!response.ok) throw await readError(response, "could not export account data.");
  return response.blob();
}

export async function importMigrationArchiveAction(
  auth: ActionAuth,
  archive: unknown,
): Promise<MigrationArchiveImportResult> {
  const headers = new Headers(authHeaders(auth));
  headers.set("Content-Type", "application/json");
  const response = await fetch(backendUrl("/api/v1/migration/import"), {
    method: "POST",
    headers,
    body: JSON.stringify(archive),
  });
  if (!response.ok) throw await readError(response, "could not import the archive.");
  return await response.json() as MigrationArchiveImportResult;
}
