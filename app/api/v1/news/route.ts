import { NextRequest, NextResponse } from "next/server";
import { getServerPB } from "@/lib/pb";

interface FeedItem {
  title: string;
  link: string;
  pubDate: string | Date;
  [key: string]: any;
}

interface Subscription {
  category: string;
  feedUrl: string;
  icon?: string;
  name?: string;
}

interface NewsFeedRecord {
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

function escapeFilter(str: string) {
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

//Get a user's feed
export async function GET(req: NextRequest) {
  try {
    const category = req.nextUrl.searchParams.get("category");
    const serverPb = getServerPB();
    const authHeader = req.headers.get("authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.split(" ")[1];
    serverPb.authStore.save(token, null);

    let authData;
    try {
      authData = await serverPb.collection("users").authRefresh();
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = authData?.record?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const filter = `userId="${escapeFilter(userId)}"`;
    let record: NewsFeedRecord | null = null;

    try {
      record = await serverPb.collection("newsFeeds").getFirstListItem<
        NewsFeedRecord
      >(filter);
    } catch (e: any) {
      if (e?.status === 404) {
        return NextResponse.json({ feed: {}, subscriptions: [] }, {
          status: 200,
        });
      }
      throw e;
    }

    const subscriptions = record.subscriptions ?? [];
    let feed: Record<string, FeedItem[]> = {};

    const urls = Array.from(
      new Set(
        subscriptions
          .map((sub) => sub?.feedUrl)
          .filter((url): url is string =>
            typeof url === "string" && url.length > 0
          ),
      ),
    );

    console.log(
      `User ${userId} has ${subscriptions.length} subscriptions, ${urls.length} unique feed URLs`,
    );

    const cacheByUrl = {};

    if (urls.length > 0) {
      const filter = urls.map((url) => `url="${escapeFilter(url)}"`).join(
        " || ",
      );
      const cacheRecords = await serverPb
        .collection("newsFeedItemsCache")
        .getFullList<NewsFeedItemsCacheRecord>({ filter });
      console.log(
        `Fetched ${cacheRecords.length} cache records for user ${userId}`,
      );
      for (const cacheRecord of cacheRecords) {
        cacheByUrl[cacheRecord.url] = cacheRecord.json ?? [];
      }
      console.log("cache", cacheByUrl)
    }

    for (const sub of subscriptions) {
      if (!sub?.category || !sub?.feedUrl) continue;
      if (!feed[sub.category]) {
        feed[sub.category] = [];
      }
      feed[sub.category].push(...(cacheByUrl[sub.feedUrl]));
      console.log("feed here", feed);
    }

    for (const feedCategory of Object.keys(feed)) {
      feed[feedCategory] = feed[feedCategory]
        .sort((a, b) => itemTime(b) - itemTime(a))
        .slice(0, 10);
    }

    if (category && category !== "All") {
      feed = feed[category] ? { [category]: feed[category] } : {};
    }

    console.log(`Returning feed for user ${userId}:`, {
      feed
    });

    return NextResponse.json({
      feed,
      subscriptions,
    });
  } catch (err: any) {
    console.error("Error in GET /api/feed:", err);
    return NextResponse.json(
      { error: "Internal Server Error", details: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
