import { RedisClient } from "bun";

const redisUrl = Bun.env.REDIS_URL || Bun.env.VALKEY_URL || "redis://127.0.0.1:6379";
const client = new RedisClient(redisUrl);

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
