import { getServerPB } from "@/lib/pb";
import { getSuperuserPB } from "@/lib/pb";
import { NextRequest } from "next/server";
import { NextResponse } from "next/server";

interface UpdateRequestBody {
  oldFeedUrl: string;
  feedUrl: string;
  name: string;
  icon: string;
  category: string;
}

/** Updates one existing subscription entry for the authenticated user. */
export async function POST(req: NextRequest) {
  try {
    const body = await validateBody(req);

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

    const superPb = await getSuperuserPB();
    const filter = `userId="${escapeFilter(userId)}"`;

    let record: any = null;
    try {
      record = await superPb.collection("newsFeeds").getFirstListItem(filter);
    } catch (e: any) {
      if (e?.status === 404) {
        return NextResponse.json({ message: "No feeds found" }, { status: 404 });
      }
      throw e;
    }

    let current = Array.isArray(record.subscriptions)
      ? record.subscriptions.map((x: any) => (typeof x === "string" ? { feedUrl: x } : x))
      : [];

    let found = false;
    current = current.map((s: any) => {
      if (s.feedUrl === body.oldFeedUrl) {
        found = true;
        return {
          feedUrl: body.feedUrl,
          name: body.name || s.name || body.feedUrl,
          icon: body.icon || s.icon || "",
          category: body.category || s.category || "",
        };
      }
      return s;
    });

    if (!found) {
      return NextResponse.json({ error: "Feed not found" }, { status: 404 });
    }

    await superPb.collection("newsFeeds").update(record.id, {
      subscriptions: current,
    });

    return NextResponse.json({ message: "Feed updated", subscriptions: current }, { status: 200 });
  } catch (err: any) {
    console.error("Error in POST /api/v1/news/feed-update:", err);
    return NextResponse.json(
      { error: "Internal Server Error", details: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}

function escapeFilter(str: string) {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function validateBody(req: NextRequest): Promise<UpdateRequestBody> {
  let json: any;

  try {
    json = await req.json();
  } catch {
    throw new Response("Invalid or empty JSON body", { status: 400 });
  }

  if (!json || typeof json !== "object") {
    throw new Response("Invalid JSON body", { status: 400 });
  }

  if (!json.oldFeedUrl || typeof json.oldFeedUrl !== "string") {
    throw new Response("'oldFeedUrl' is required", { status: 400 });
  }

  if (!json.feedUrl || typeof json.feedUrl !== "string") {
    throw new Response("'feedUrl' is required", { status: 400 });
  }

  return {
    oldFeedUrl: json.oldFeedUrl,
    feedUrl: json.feedUrl,
    name: json.name || "",
    icon: json.icon || "",
    category: json.category || "",
  };
}
