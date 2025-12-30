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
  feed?: Record<string, FeedItem[]>;
  [key: string]: any;
}

function escapeFilter(str: string) {
  return str.replace(/"/g, '\\"');
}

//Get a user's feed
export async function GET(req: NextRequest) {
  try {
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
      record = await serverPb.collection("newsFeeds").getFirstListItem<NewsFeedRecord>(filter);
    } catch (e: any) {
      if (e?.status === 404) {
        return NextResponse.json({ feed: {}, subscriptions: [] }, { status: 200 });
      }
      throw e;
    }
    
    return NextResponse.json({
      feed: record.feed ?? {},
      subscriptions: record.subscriptions ?? [],
    });
  } catch (err: any) {
    console.error("Error in GET /api/feed:", err);
    return NextResponse.json(
      { error: "Internal Server Error", details: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
