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

        if (ids.length === 0) {
            return NextResponse.json({ error: "Missing notification IDs" }, { status: 400 });
        }

        // --- 3. Update notifications
        const updates = ids.map(id => {
            console.log(id);
            pb.collection("notificationItems").update(id, { status: "read" });
        }
        );
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