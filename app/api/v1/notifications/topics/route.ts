import { NextRequest, NextResponse } from "next/server";
import { getServerPB } from "@/lib/pb";

export async function GET(req: NextRequest) {
    try {
        const pb = getServerPB();

        // --- 1. Require Bearer auth
        const authHeader = req.headers.get("authorization");
        if (!authHeader?.startsWith("Bearer ")) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const token = authHeader.split(" ")[1];
        pb.authStore.save(token, null);

        // refresh to validate token & get user ID
        const authModel = await pb.collection("users").authRefresh();
        const userId = authModel?.record?.id;
        if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        // --- 2. Get notification topics for this user
        const topics = await pb.collection("notificationTopics").getFullList({
            filter: `userId="${userId}"`,
        });

        // Return empty array if no topics found
        return NextResponse.json({ items: topics.map(t => ({ id: t.id, title: t.title })) });
    } catch (err: any) {
        console.error("Error in GET /notificationTopics", err);
        return NextResponse.json(
            { error: "Internal Server Error", details: err.message },
            { status: 500 }
        );
    }
}

type NotificationTopic = {
  id: string;
  title: string;
  userId: string;
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { title } = body;

    if (!title) {
      return NextResponse.json({ error: "Missing topic title" }, { status: 400 });
    }

    const pb = getServerPB();

    // --- Require Bearer auth
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.split(" ")[1];
    pb.authStore.save(token, null);

    // Refresh to validate token & get user ID
    const authModel = await pb.collection("users").authRefresh();
    const userId = authModel?.record?.id;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // --- Check if topic already exists
    let existingTopic: NotificationTopic | null = null;
    try {
      existingTopic = await pb
        .collection("notificationTopics")
        .getFirstListItem<NotificationTopic>(`title="${title}" && userId="${userId}"`);
    } catch {
      existingTopic = null;
    }

    if (existingTopic) {
      return NextResponse.json({ ok: true, topicId: existingTopic.id });
    }

    // --- Create new topic
    const created: NotificationTopic = await pb.collection("notificationTopics").create({
      title,
      userId,
      priority: 1,
    });

    // --- Create initial "topic created" notification
    await pb.collection("notificationItems").create({
      topicId: created.id,
      content: "Topic has been created",
      status: "sent",
      source: "web",
    });

    return NextResponse.json({ ok: true, topicId: created.id });
  } catch (err: any) {
    console.error("Error in POST /notificationTopics", err);
    return NextResponse.json(
      { error: "Internal Server Error", details: err.message },
      { status: 500 }
    );
  }
}
