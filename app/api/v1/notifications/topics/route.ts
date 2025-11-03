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
