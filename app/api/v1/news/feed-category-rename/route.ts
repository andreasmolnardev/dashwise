import { getServerPB } from "@/lib/pb";
import { getSuperuserPB } from "@/lib/pb";
import { NextRequest } from "next/server";
import { NextResponse } from "next/server";

interface RenameRequestBody {
  oldCategory: string;
  newCategory: string;
}

/** Renames a feed category across all saved subscriptions for the current user. */
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

    const oldCat = body.oldCategory;
    const newCat = body.newCategory;

    let current = Array.isArray(record.subscriptions)
      ? record.subscriptions.map((x: any) => (typeof x === "string" ? { feedUrl: x } : x))
      : [];

    let changed = false;
    current = current.map((s: any) => {
      const cat = (s.category ?? "").toString();
      if (cat === oldCat) {
        changed = true;
        return { ...s, category: newCat };
      }
      return s;
    });

    if (changed) {
      await superPb.collection("newsFeeds").update(record.id, {
        subscriptions: current,
      });
    }

    return NextResponse.json({ message: "Category rename applied", changed }, { status: 200 });
  } catch (err: any) {
    console.error("Error in POST /api/v1/news/feed-category-rename:", err);
    return NextResponse.json(
      { error: "Internal Server Error", details: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}

function escapeFilter(str: string) {
  return str.replace(/"/g, '\\"');
}

async function validateBody(req: NextRequest): Promise<RenameRequestBody> {
  let json: any;

  try {
    json = await req.json();
  } catch {
    throw new Response("Invalid or empty JSON body", { status: 400 });
  }

  if (!json || typeof json !== "object") {
    throw new Response("Invalid JSON body", { status: 400 });
  }

  if (!json.oldCategory || typeof json.oldCategory !== "string") {
    throw new Response("'oldCategory' is required", { status: 400 });
  }

  if (!json.newCategory || typeof json.newCategory !== "string") {
    throw new Response("'newCategory' is required", { status: 400 });
  }

  return {
    oldCategory: json.oldCategory,
    newCategory: json.newCategory,
  };
}
