import { NextRequest, NextResponse } from "next/server";
import { getServerPB, getSuperuserPB } from "@/lib/pb";

// ----------------------------------------
// Types
// ----------------------------------------
interface SubscribeRequestBody {
    feedUrl: string;
    name?: string;
    icon?: string;
    category?: string;
}

// ----------------------------------------
// Utility: escape PocketBase filter values
// ----------------------------------------
function escapeFilter(str: string) {
    return str.replace(/"/g, '\\"');
}

// ----------------------------------------
// Validation: validateBody(req)
// ----------------------------------------
async function validateBody(req: NextRequest): Promise<SubscribeRequestBody> {
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
        name: json.name ?? "",
        icon: json.icon ?? "",
        category: json.category ?? "",
    };
}


// ----------------------------------------
// Data Layer: addNewsFeed()
// ----------------------------------------
async function addNewsFeed(
    pb: any,
    userId: string,
    sub: SubscribeRequestBody
) {
    const filter = `userId="${escapeFilter(userId)}"`;

    let record: any = null;

    // Try to load existing record
    try {
        record = await pb.collection("newsFeeds").getFirstListItem(filter);
    } catch (e: any) {
        if (e?.status === 404) {
            // No record → create new one
            return pb.collection("newsFeeds").create({
                userId,
                subscriptions: [sub],
            });
        }
        throw e;
    }

    // Normalize existing subscriptions
    let current = Array.isArray(record.subscriptions)
        ? record.subscriptions.map((x: any) =>
            typeof x === "string" ? { feedUrl: x } : x
        )
        : [];

    // Prevent duplicates
    const exists = current.some((x) => x.feedUrl === sub.feedUrl);
    if (!exists) {
        current.push(sub);
        await pb.collection("newsFeeds").update(record.id, {
            subscriptions: current,
        });
    }

    return record;
}

// ----------------------------------------
// Data Layer: addScrapingJob()
// ----------------------------------------
async function addScrapingJob(
    pb: any,
    userId: string,
    feedUrl: string
) {
    const filter = `userId="${escapeFilter(
        userId
    )}" && endpoint="${escapeFilter(feedUrl)}"`;

    try {
        await pb.collection("scrapingJobs").getFirstListItem(filter);
        return; // Exists → nothing to do
    } catch (e: any) {
        if (e?.status !== 404) throw e;
    }

    // Create new scraping job entry
    return pb.collection("scrapingJobs").create({
        userId,
        endpoint: feedUrl,
        latest: {},
    });
}

// ----------------------------------------
// POST Route
// ----------------------------------------
export async function POST(req: NextRequest) {
    try {
        // Validate JSON
        const body = await validateBody(req);

        const { feedUrl } = body;

        // -------------------------
        // Authentication
        // -------------------------
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

        // Super user PB for writes
        const superPb = await getSuperuserPB();

        // -------------------------
        // Data operations
        // -------------------------
        await addNewsFeed(superPb, userId, body);
        await addScrapingJob(superPb, userId, feedUrl);

        // -------------------------
        // Response
        // -------------------------
        return NextResponse.json(
            { message: "Feed successfully subscribed." },
            { status: 201 }
        );
    } catch (err: any) {
        console.error("Error in POST /api/subscribe:", err);
        return NextResponse.json(
            { error: "Internal Server Error", details: String(err?.message ?? err) },
            { status: 500 }
        );
    }
}
