import { mapJellyfinItems, type JellyfinResource } from "./mapping";

/** Fetch every page before returning a snapshot so incomplete responses are never synced as complete. */
export async function fetchJellyfinLibrary(
  fetchPage: (startIndex: number, limit: number) => Promise<unknown>,
  pageSize = 500,
): Promise<JellyfinResource[]> {
  const resources = new Map<string, JellyfinResource>();
  let startIndex = 0;
  while (true) {
    const response = await fetchPage(startIndex, pageSize);
    if (!response || typeof response !== "object" || Array.isArray(response) || !Array.isArray((response as any).Items)) {
      throw new Error("Jellyfin returned an invalid item list");
    }
    const page = response as { Items: unknown[]; TotalRecordCount?: unknown };
    for (const resource of mapJellyfinItems(response)) resources.set(resource.id, resource);
    const count = page.Items.length;
    const total = typeof page.TotalRecordCount === "number" && Number.isSafeInteger(page.TotalRecordCount) && page.TotalRecordCount >= 0
      ? page.TotalRecordCount
      : undefined;
    if (count === 0 || (total !== undefined ? startIndex + count >= total : count < pageSize)) break;
    startIndex += count;
  }
  return [...resources.values()];
}
