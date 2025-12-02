import { NextRequest, NextResponse } from "next/server";
import { getServerPB, getSuperuserPB } from "@/lib/pb";
import { createNotificationWithTopicToken, resolveTopicToken } from "@/lib/notifications/create";

export async function GET(req: NextRequest) {
    try {
        const pb = getServerPB();

        // --- 1. Require Bearer auth
        const authHeader = req.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const token = authHeader.split(" ")[1];
        pb.authStore.save(token, null);

        // refresh to validate and get user id
        const authModel = await pb.collection("users").authRefresh();
        const userId = authModel?.record?.id ?? null;

        if (!userId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // --- 2. Lookup all topics for user
        const topics = await pb.collection("notificationTopics").getFullList({
            filter: `userId="${userId}"`,
        });
        const topicIds = topics.map(t => t.id);

        if (!topicIds) {
            return NextResponse.json({}, { status: 204 });
        }

        if (topicIds.length === 0) {
            return NextResponse.json({ items: [] });
        }

        // --- 3. Handle filters
        const searchParams = req.nextUrl.searchParams;
        const unread = searchParams.get("unread") === "true";
        const count = searchParams.get("count") === "true";

        let filter = topicIds.map(id => `topicId="${id}"`).join(" || ");

        if (unread) {
            filter = `(${filter}) && status!="read"`;
        }

        // --- 4. Query notifications
        const items = await pb.collection("notificationItems").getFullList({
            filter,
            expand: "topicId",
            sort: "-created",
        });

        if (count) {
            return NextResponse.json({
                total: items.length,
                unread: items.filter(i => i.status !== "read").length,
            });
        }

        // --- 4.1 Mark previously "sent" items as "received" (only when returning full list)
        // (We skip this when `count` was requested to avoid side-effects.)
        const sentItems = items.filter(i => i.status === "sent");
        if (sentItems.length > 0) {
            const updatePromises = sentItems.map(it =>
                pb.collection("notificationItems").update(it.id, { status: "received" })
            );
            const results = await Promise.allSettled(updatePromises);

            results.forEach((r, idx) => {
                if (r.status === "rejected") {
                    console.error(`Failed to update notification ${sentItems[idx].id}:`, r.reason);
                }
            });

            items.forEach(it => {
                if (it.status === "sent") it.status = "received";
            });
        }

        // build id->title map from earlier `topics`
        const topicMap = Object.fromEntries(topics.map(t => [t.id, t.title]));

        // map items to result using the map as fallback for topicName
        const result = items.map(it => {
            const topicId = typeof it.topicId === "string" ? it.topicId : it.topicId?.id ?? null;
            return {
                id: it.id,
                content: it.content,
                status: it.status,
                created: it.created,
                topicId,
                topicName: topicMap[topicId] ?? null,
            };
        });

        return NextResponse.json({ items: result });
    } catch (err: any) {
        console.error("Error in GET /notifications", err);
        return NextResponse.json(
            { error: "Internal Server Error", details: err.message },
            { status: 500 }
        );
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json().catch(() => ({}));


        // --- 1. Get topic token from header or query
        let token = req.headers.get("authorization")?.startsWith("Bearer ")
            ? req.headers.get("authorization")!.split(" ")[1]
            : req.nextUrl.searchParams.get("token");

        if (!token) {
            return NextResponse.json({ error: "Missing topic token" }, { status: 401 });
        }

        const topicId = resolveTopicToken(token);

        if (!topicId) {
            return NextResponse.json({ ok: false, }, { status: 400 });
        }

        const createdNotificationId = createNotificationWithTopicToken(token, body);

        return NextResponse.json({ ok: true, topicId, itemId: createdNotificationId }, { status: 201 });
    } catch (err: any) {
        console.error("Error in POST /notifications via topic token", err);
        return NextResponse.json(
            { error: "Internal Server Error", details: String(err?.message ?? err) },
            { status: 500 }
        );
    }
}

