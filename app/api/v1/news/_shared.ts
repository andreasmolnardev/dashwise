import { NextRequest } from "next/server";
import { getServerPB, getSuperuserPB } from "@/lib/pb";

export interface FeedItem {
  title: string;
  link: string;
  pubDate: string | Date;
  [key: string]: any;
}

export interface Subscription {
  category: string;
  feedUrl: string;
  icon?: string;
  name?: string;
}

export interface NewsFeedRecord {
  id: string;
  userId: string;
  subscriptions?: Subscription[];
  [key: string]: any;
}

interface NewsFeedItemsCacheRecord {
  id: string;
  url: string;
  json?: string;
  [key: string]: any;
}

export function escapeFilter(str: string) {
  return str.replace(/"/g, '\\"');
}

function itemTime(item: FeedItem): number {
  const value = item?.pubDate;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? 0 : time;
  }
  return 0;
}

export async function authenticateUserId(req: NextRequest): Promise<string | null> {
  const serverPb = getServerPB();
  const authHeader = req.headers.get("authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.split(" ")[1];
  serverPb.authStore.save(token, null);

  try {
    const authData = await serverPb.collection("users").authRefresh();
    return authData?.record?.id || null;
  } catch {
    return null;
  }
}

export async function getUserNewsFeedRecord(userId: string): Promise<NewsFeedRecord | null> {
  const superPb = await getSuperuserPB();
  const filter = `userId="${escapeFilter(userId)}"`;

  try {
    return await superPb.collection("newsFeeds").getFirstListItem<NewsFeedRecord>(filter);
  } catch (e: any) {
    if (e?.status === 404) return null;
    throw e;
  }
}

export async function buildFeedFromSubscriptions(
  subscriptions: Subscription[],
  category?: string | null
): Promise<Record<string, FeedItem[]>> {
  const superPb = await getSuperuserPB();

  let feed: Record<string, FeedItem[]> = {};

  const urls = Array.from(
    new Set(
      subscriptions
        .map((sub) => sub?.feedUrl)
        .filter((url): url is string => typeof url === "string" && url.length > 0)
    )
  );

  const cacheByUrl: Record<string, FeedItem[]> = {};

  if (urls.length > 0) {
    const filter = urls.map((url) => `url="${escapeFilter(url)}"`).join(" || ");
    const cacheRecords = await superPb
      .collection("newsFeedItemsCache")
      .getFullList<NewsFeedItemsCacheRecord>({ filter });

    for (const cacheRecord of cacheRecords) {
      const raw = cacheRecord.json;
      if (!raw) {
        cacheByUrl[cacheRecord.url] = [];
        continue;
      }

      try {
        if (typeof raw === "string") {
          const parsed = JSON.parse(raw);
          cacheByUrl[cacheRecord.url] = Array.isArray(parsed) ? parsed : [];
        } else if (Array.isArray(raw)) {
          cacheByUrl[cacheRecord.url] = raw;
        } else {
          cacheByUrl[cacheRecord.url] = [];
        }
      } catch (parseErr) {
        console.warn("Failed to parse cached feed JSON for", cacheRecord.url, parseErr);
        cacheByUrl[cacheRecord.url] = [];
      }
    }
  }

  for (const sub of subscriptions) {
    if (!sub?.category || !sub?.feedUrl) continue;
    if (!feed[sub.category]) {
      feed[sub.category] = [];
    }

    const items = Array.isArray(cacheByUrl[sub.feedUrl]) ? cacheByUrl[sub.feedUrl] : [];
    feed[sub.category].push(...items);
  }

  for (const feedCategory of Object.keys(feed)) {
    feed[feedCategory] = feed[feedCategory]
      .sort((a, b) => itemTime(b) - itemTime(a))
      .slice(0, 10);
  }

  if (category && category !== "All") {
    feed = feed[category] ? { [category]: feed[category] } : {};
  }

  return feed;
}
