import { NextRequest, NextResponse } from "next/server";
import {
  authenticateUserId,
  buildFeedFromSubscriptions,
  getUserNewsFeedRecord,
} from "../_shared";

export async function GET(req: NextRequest) {
  try {
    const userId = await authenticateUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const category = req.nextUrl.searchParams.get("category");
    const record = await getUserNewsFeedRecord(userId);

    if (!record) {
      return NextResponse.json({ feed: {} }, { status: 200 });
    }

    const subscriptions = record.subscriptions ?? [];
    const feed = await buildFeedFromSubscriptions(subscriptions, category);

    return NextResponse.json({ feed }, { status: 200 });
  } catch (err: any) {
    console.error("Error in GET /api/v1/news/feed:", err);
    return NextResponse.json(
      { error: "Internal Server Error", details: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
