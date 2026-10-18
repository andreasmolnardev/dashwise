type PageWidgetItem = Record<string, unknown>;

const SNAPSHOT_TTL_MS = 9_000;
const MAX_SNAPSHOTS = 100;
const snapshots = new Map<string, { expiresAt: number; items: PageWidgetItem[] }>();
const pendingSnapshots = new Map<string, Promise<PageWidgetItem[]>>();

/** Share recent page widget resolutions across sockets for the same user and page. */
export function getSharedPageWidgetSnapshot(
  userId: string,
  pageId: string,
  resolve: () => Promise<PageWidgetItem[]>,
  now: () => number = Date.now,
) {
  const key = JSON.stringify([userId, pageId]);
  const cached = snapshots.get(key);
  if (cached && cached.expiresAt > now()) return Promise.resolve(cached.items);

  const pending = pendingSnapshots.get(key);
  if (pending) return pending;

  const request = resolve().then((items) => {
    snapshots.set(key, { expiresAt: now() + SNAPSHOT_TTL_MS, items });
    const currentTime = now();
    for (const [snapshotKey, snapshot] of snapshots) {
      if (snapshot.expiresAt <= currentTime) snapshots.delete(snapshotKey);
    }
    while (snapshots.size > MAX_SNAPSHOTS) {
      const oldestKey = snapshots.keys().next().value;
      if (oldestKey === undefined) break;
      snapshots.delete(oldestKey);
    }
    return items;
  }).finally(() => {
    pendingSnapshots.delete(key);
  });
  pendingSnapshots.set(key, request);
  return request;
}
