import { NextRequest, NextResponse } from "next/server";
import { getServerPB } from "@/lib/pb";
import {
    createNotificationForUserTopic,
    createNotificationWithTopicToken,
    queueNotificationForForwarding,
} from "@dashwise/sdk/data/notifications/publish";

export async function POST(
    req: NextRequest,
    context: { params: Promise<{ topic?: string }> }
) {
    try {
        const { topic } = await context.params;
        const body = await req.json();

        if (!topic) {
            return NextResponse.json({ error: "Missing topic" }, { status: 400 });
        }

        // 1. Extract Authorization header or ?auth=
        let authHeader = req.headers.get("authorization");
        if (!authHeader) {
            const authParam = req.nextUrl.searchParams.get("auth");
            if (authParam) {
                try {
                    authHeader = Buffer.from(authParam, "base64").toString("utf8");
                } catch {
                    return NextResponse.json(
                        { error: "Invalid auth parameter" },
                        { status: 400 }
                    );
                }
            }
        }

        // 2. Token-only mode: treat [topic] as topic token
        if (!authHeader) {
            const created = await createNotificationWithTopicToken(topic, body);
            if (!created) {
                return NextResponse.json({ ok: false }, { status: 400 });
            }

            await queueNotificationForForwarding(created.itemId);
            return NextResponse.json({ ok: true, topicId: created.topicId, itemId: created.itemId }, { status: 201 });
        }

        // 3. Authenticated mode: treat [topic] as topic title
        const pb = getServerPB();
        let userId: string | null = null;

        if (authHeader.startsWith("Bearer ")) {
            const token = authHeader.split(" ")[1];
            pb.authStore.save(token, null);
            if (pb.authStore.isAdmin) {
                // Admins don’t have a userId – require it in body
                userId = body.userId;
                if (!userId) {
                    return NextResponse.json(
                        { error: "Admin requests must include userId in body" },
                        { status: 400 }
                    );
                }
            } else {
                const authModel = await pb.collection("users").authRefresh();
                userId = authModel?.record?.id ?? null;
            }
        } else if (authHeader.startsWith("Basic ")) {
            const b64 = authHeader.split(" ")[1] ?? "";
            const decoded = Buffer.from(b64, "base64").toString("utf8");
            const idx = decoded.indexOf(":");
            if (idx === -1) {
                return NextResponse.json(
                    { error: "Invalid Basic auth format" },
                    { status: 400 }
                );
            }
            const identity = decoded.slice(0, idx);
            const password = decoded.slice(idx + 1);
            const authModel = await pb
                .collection("users")
                .authWithPassword(identity, password);
            userId = authModel?.record?.id ?? null;
        } else {
            return NextResponse.json(
                { error: "Unsupported auth scheme" },
                { status: 401 }
            );
        }

        if (!userId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const created = await createNotificationForUserTopic({
            userId,
            topic,
            content: body,
            source: "web",
        });
        await queueNotificationForForwarding(created.itemId);

        return NextResponse.json({ ok: true, topicId: created.topicId, itemId: created.itemId });
    } catch (err: any) {
        console.error("Error in POST /[topic]", err);
        return NextResponse.json(
            { error: "Internal Server Error", details: String(err?.message ?? err) },
            { status: 500 }
        );
    }
}
