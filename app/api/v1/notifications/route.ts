import { NextRequest, NextResponse } from "next/server";
import { requireUserAuth } from "@dashwise/sdk/data/auth";
import { getNotifications } from "@dashwise/sdk/data/notifications/items";
import {
    createNotificationWithTopicToken,
    queueNotificationForForwarding,
} from "@dashwise/sdk/data/notifications/publish";

export async function GET(req: NextRequest) {
    try {
        const authHeader = req.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const token = authHeader.split(" ")[1];
        const { userId } = await requireUserAuth({ token });

        const searchParams = req.nextUrl.searchParams;
        const unread = searchParams.get("unread") === "true";
        const count = searchParams.get("count") === "true";
        return NextResponse.json(await getNotifications(userId, unread, count));
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

        const token = req.headers.get("authorization")?.startsWith("Bearer ")
            ? req.headers.get("authorization")!.split(" ")[1]
            : req.nextUrl.searchParams.get("token");

        if (!token) {
            return NextResponse.json({ error: "Missing topic token" }, { status: 401 });
        }

        const created = await createNotificationWithTopicToken(token, body);
        if (!created) {
            return NextResponse.json({ ok: false }, { status: 400 });
        }

        await queueNotificationForForwarding(created.itemId);

        return NextResponse.json({ ok: true, topicId: created.topicId, itemId: created.itemId }, { status: 201 });
    } catch (err: any) {
        console.error("Error in POST /notifications via topic token", err);
        return NextResponse.json(
            { error: "Internal Server Error", details: String(err?.message ?? err) },
            { status: 500 }
        );
    }
}

