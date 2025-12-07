import { NextRequest, NextResponse } from "next/server";
import { getServerPB, getSuperuserPB } from "@/lib/pb";

interface UnsubscribeRequestBody {
    feedUrl: string;
}

export async function POST(req: NextRequest) {
    try {
        // Validate JSON
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

        // await db call
        await removeNewsFeed(superPb, userId, body);

        return NextResponse.json(
            { message: "Feed successfully unsubscribed." },
            { status: 200 }
        );
    } catch (err: any) {
        console.error("Error in POST /api/news/feed-unsubscribe:", err);
        return NextResponse.json(
            { error: "Internal Server Error", details: String(err?.message ?? err) },
            { status: 500 }
        );
    }
}

function escapeFilter(str: string) {
    return str.replace(/"/g, '\\"');
}

async function validateBody(req: NextRequest): Promise<UnsubscribeRequestBody> {
    let json: any;

    try {
        json = await req.json();
    } catch {
        throw new Response("Invalid or empty JSON body", { status: 400 });
    }

    if (!json || typeof json !== "object") {
        throw new Response("Invalid JSON body", { status: 400 });
    }

    if (!json.feedUrl || typeof json.feedUrl !== "string") {
        throw new Response("'feedUrl' is required", { status: 400 });
    }

    return {
        feedUrl: json.feedUrl,
    };
}

async function removeNewsFeed(
    pb: any,
    userId: string,
    req: UnsubscribeRequestBody
) {
    const filter = `userId="${escapeFilter(userId)}"`;

    let record: any = null;

    try {
        record = await pb.collection("newsFeeds").getFirstListItem(filter);
    } catch (e: any) {
        if (e?.status === 404) {
            throw new Error("No feeds found");
        }
        throw e;
    }

    let current = Array.isArray(record.subscriptions)
        ? record.subscriptions.map((x: any) =>
            typeof x === "string" ? { feedUrl: x } : x
        )
        : [];

    // Remove the feed
    current = current.filter((x) => x.feedUrl !== req.feedUrl);

    await pb.collection("newsFeeds").update(record.id, {
        subscriptions: current,
    });

    return record;
}
