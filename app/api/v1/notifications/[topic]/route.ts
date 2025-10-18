import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getServerPB } from "@/lib/pb";

export async function POST(
    req: NextRequest,
    context: { params: Promise<{ topic: string }> }
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
        if (!authHeader) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // 2. Authenticate with PocketBase
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

        // 3. Lookup notificationTopic
        const filter = `title="${topic}" && userId="${userId}"`;
        let existing: Record<string, any> | null = null;
        try {
            existing = await pb
                .collection("notificationTopics")
                .getFirstListItem(filter);
        } catch {
            existing = null;
        }

        let topicId: string;
        if (existing) {
            topicId = existing.id;
        } else {
            // Create notificationTopic with uuidv4 + priority 1
            const created = await pb.collection("notificationTopics").create({
                title: topic,
                userId,
                priority: 1,
            });
            topicId = created.id;
        }

        // 4. Always create a notificationItem under this topic
        const notificationItem = await pb.collection("notificationItems").create({
            topicId,
            content: body,
            status: "sent",
            source: "web"
        });

        return NextResponse.json({ ok: true, topicId, itemId: notificationItem.id });
    } catch (err: any) {
        console.error("Error in POST /[topic]", err);
        return NextResponse.json(
            { error: "Internal Server Error", details: String(err?.message ?? err) },
            { status: 500 }
        );
    }
}
