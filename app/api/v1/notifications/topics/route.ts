import { getServerPB } from "@/lib/pb";
import { NextRequest } from "next/server";
import { NextResponse } from "next/server";

type NotificationTopic = {
  id: string;
  title: string;
  userId: string;
};

/** Returns notification topics for the authenticated user for selector UIs. */
export async function GET(req: NextRequest) {
  try {
    const pb = getServerPB();
    const authHeader = req.headers.get("authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.split(" ")[1];
    pb.authStore.save(token, null);

    const authModel = await pb.collection("users").authRefresh();
    const userId = authModel?.record?.id;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const topics = await pb.collection("notificationTopics").getFullList({
      filter: `userId="${userId}"`,
    });

    return NextResponse.json({ items: topics.map((t) => ({ id: t.id, title: t.title })) });
  } catch (err: any) {
    console.error("Error in GET /notificationTopics", err);
    return NextResponse.json(
      { error: "Internal Server Error", details: err.message },
      { status: 500 }
    );
  }
}

/** Creates a topic when needed and seeds it with an initial system notification. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { title } = body;

    if (!title) {
      return NextResponse.json({ error: "Missing topic title" }, { status: 400 });
    }

    const pb = getServerPB();
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.split(" ")[1];
    pb.authStore.save(token, null);

    const authModel = await pb.collection("users").authRefresh();
    const userId = authModel?.record?.id;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

    const created: NotificationTopic = await pb.collection("notificationTopics").create({
      title,
      userId,
      priority: 1,
    });

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
