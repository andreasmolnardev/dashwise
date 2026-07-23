import { RedisClient } from "bun";

const redisUrl = Bun.env.REDIS_URL || Bun.env.VALKEY_URL || "redis://127.0.0.1:6379";
const client = new RedisClient(redisUrl);

export async function readFeedItemsCache(feedId: string): Promise<unknown[] | null> {
  const raw = await client.hget(`feedItems:${feedId}`, "json");
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeFeedItemsCache(
  feedId: string,
  items: unknown[],
  feedIds: string[] = [feedId],
) {
  await client.hmset(`feedItems:${feedId}`, [
    "json", JSON.stringify(items),
    "date", new Date().toISOString(),
    "feedIds", JSON.stringify(feedIds),
  ]);
}
