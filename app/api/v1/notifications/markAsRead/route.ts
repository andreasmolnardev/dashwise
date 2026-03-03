import { getServerPB } from "@/lib/pb";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
    try {
        const pb = getServerPB();

        // --- 1. Require Bearer auth
        const authHeader = req.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const token = authHeader.split(" ")[1];
        pb.authStore.save(token, null);

        const authModel = await pb.collection("users").authRefresh();
        const userId = authModel?.record?.id ?? null;

        if (!userId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // --- 2. Parse body
        const body = await req.json().catch(() => ({}));
        const ids = Array.isArray(body.ids)
            ? body.ids
            : body.id
                ? [body.id]
                : [];

        let targetIds = ids;
        if (targetIds.length === 0) {
            const topics = await pb.collection("notificationTopics").getFullList({
                filter: `userId="${userId}"`,
            });

            const topicIds = topics.map(t => t.id);

            if (topicIds.length === 0) {
                return new NextResponse(null, { status: 204 });
            }

            const filter = topicIds.map(id => `topicId="${id}"`).join(" || ");
            const items = await pb.collection("notificationItems").getFullList({
                filter,
                sort: "-created",
            });

            const unreadItems = items.filter(item => item.status !== "read");
            if (unreadItems.length === 0) {
                return new NextResponse(null, { status: 204 });
            }

            const markAllUpdates = unreadItems.map(item => markNotificationAsRead(item.id, pb));
            await Promise.allSettled(markAllUpdates);
            return new NextResponse(null, { status: 204 });
        }

        // --- 3. Update notifications
        const updates = targetIds.map(id => markNotificationAsRead(id, pb));
        await Promise.allSettled(updates);

        // --- 4. Return no content
        return new NextResponse(null, { status: 204 });
    } catch (err: any) {
        console.error("Error in POST /notifications/mark-read:", err);
        return NextResponse.json(
            { error: "Internal Server Error", details: err.message },
            { status: 500 }
        );
    }
}

async function markNotificationAsRead(
    notificationId: string,
    pbClient?: ReturnType<typeof getServerPB>
) {
    const client = pbClient ?? getServerPB();
    return client.collection("notificationItems").update(notificationId, { status: "read" });
}