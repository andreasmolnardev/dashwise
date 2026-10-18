type PageWidgetItem = Record<string, unknown>;

const SNAPSHOT_TTL_MS = 9_000;
const snapshots = new Map<string, { expiresAt: number; items: PageWidgetItem[] }>();
const pendingSnapshots = new Map<string, Promise<PageWidgetItem[]>>();

/** Share recent page widget resolutions across sockets for the same user and page. */
export function getSharedPageWidgetSnapshot(
  userId: string,
  pageId: string,
  resolve: () => Promise<PageWidgetItem[]>,
) {
  const key = JSON.stringify([userId, pageId]);
  const cached = snapshots.get(key);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.items);

  const pending = pendingSnapshots.get(key);
  if (pending) return pending;

  const request = resolve().then((items) => {
    snapshots.set(key, { expiresAt: Date.now() + SNAPSHOT_TTL_MS, items });
    return items;
  }).finally(() => {
    pendingSnapshots.delete(key);
  });
  pendingSnapshots.set(key, request);
  return request;
}
