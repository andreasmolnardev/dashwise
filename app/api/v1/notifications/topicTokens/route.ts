import { NextRequest, NextResponse } from "next/server";
import { getServerPB } from "@/lib/pb";
import crypto from "crypto";

function requireBearerAuth(req: NextRequest) {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return null;
    return authHeader.split(" ")[1];
}

export async function POST(req: NextRequest) {
    try {
        const pb = getServerPB();

        // --- 1. Require Bearer auth
        const tokenHeader = requireBearerAuth(req);
        if (!tokenHeader) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        pb.authStore.save(tokenHeader, null);
        const authModel = await pb.collection("users").authRefresh();
        const userId = authModel?.record?.id ?? null;
        if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        // --- 2. Parse body
        const body = await req.json().catch(() => ({}));
        const { topicId, topicName, expires } = body;

        if (!topicId && !topicName) {
            return NextResponse.json({ error: "Missing topicId or topicName" }, { status: 400 });
        }

        // --- 3. Resolve topic (ensure it belongs to the authed user)
        let topicRecord: any = null;
        if (topicId) {
            try {
                topicRecord = await pb.collection("notificationTopics").getOne(topicId);
                if (!topicRecord || topicRecord.userId !== userId) {
                    return NextResponse.json({ error: "Topic not found or not owned by user" }, { status: 404 });
                }
            } catch (err) {
                return NextResponse.json({ error: "Topic not found", details: (err as any).message }, { status: 404 });
            }
        } else if (topicName) {
            // Escape double quotes in topicName for the filter
            const safeName = String(topicName).replace(/"/g, '\\"');
            const topics = await pb.collection("notificationTopics").getFullList({ filter: `userId="${userId}" && title="${safeName}"` });
            if (!topics || topics.length === 0) {
                return NextResponse.json({ error: "Topic not found for user with that name" }, { status: 404 });
            }
            topicRecord = topics[0];
        }

        if (!topicRecord) {
            return NextResponse.json({ error: "Unable to resolve topic" }, { status: 400 });
        }

        // --- 4. Generate secure random token
        const rawToken = crypto.randomBytes(48).toString("hex"); // 96 hex chars ~ secure
        // NOTE: we store the raw token (without "Bearer " prefix). When clients send it as Authorization header,
        // they'll do: Authorization: Bearer <rawToken>

        // Build create payload
        const createPayload: any = {
            token: rawToken,
            topic: topicRecord.id, // relation field -> set topic id
        };

        if (expires) {
            // Accept string or Date-like; validate
            const expiresDate = new Date(expires);
            if (isNaN(expiresDate.getTime())) {
                return NextResponse.json({ error: "Invalid expires date" }, { status: 400 });
            }
            createPayload.expires = expiresDate.toISOString();
        }

        // --- 5. Create record
        const created = await pb.collection("notificationTopicTokens").create(createPayload);

        // Optionally expand topic when returning
        const createdExpanded = {
            ...created,
            token: rawToken, // include token value in response
            topic: topicRecord, // include basic topic data
        };

        return NextResponse.json({ item: createdExpanded }, { status: 201 });
    } catch (err: any) {
        console.error("Error in POST /notificationTopicTokens:", err);
        return NextResponse.json({ error: "Internal Server Error", details: err.message }, { status: 500 });
    }
}

export async function GET(req: NextRequest) {
    try {
        const pb = getServerPB();

        // --- 1. Require Bearer auth
        const tokenHeader = requireBearerAuth(req);
        if (!tokenHeader) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        pb.authStore.save(tokenHeader, null);
        const authModel = await pb.collection("users").authRefresh();
        const userId = authModel?.record?.id;
        if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        // --- 2. Get notification topics for this user (to know which topic IDs belong to them)
        const topics = await pb.collection("notificationTopics").getFullList({ filter: `userId="${userId}"` });
        const topicIds = topics.map(t => t.id);

        if (topicIds.length === 0) {
            return NextResponse.json({ items: [] });
        }

        // --- 3. Get all tokens where topic is in user's topics
        // Build a PocketBase 'in' filter: topic in ("id1","id2",...)
        const inList = topicIds.map(id => `"${id}"`).join(",");

        const tokens = await pb.collection("notificationTopicTokens").getFullList({
            filter: `topic.userId = "${userId}"`,
        });

        // Optionally expand the topic data by matching against topics we already fetched
        const topicsById = Object.fromEntries(topics.map(t => [t.id, { id: t.id, title: t.title, userId: t.userId }]));
        const items = tokens.map((tok: any) => ({
            id: tok.id,
            token: tok.token,
            topic: topicsById[tok.topic] ?? { id: tok.topic },
            expires: tok.expires ?? null,
            created: tok.created ?? null,
        }));

        return NextResponse.json({ items });
    } catch (err: any) {
        console.error("Error in GET /notificationTopicTokens:", err);
        return NextResponse.json({ error: "Internal Server Error", details: err.message }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const pb = getServerPB();

        // --- 1. Require Bearer auth
        const tokenHeader = requireBearerAuth(req);
        if (!tokenHeader) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        pb.authStore.save(tokenHeader, null);
        const authModel = await pb.collection("users").authRefresh();
        const userId = authModel?.record?.id;
        if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        // --- 2. Parse body for token ID to delete
        const body = await req.json().catch(() => ({}));
        const { tokenId } = body;
        if (!tokenId) return NextResponse.json({ error: "Missing tokenId" }, { status: 400 });

        // --- 3. Fetch token and check ownership
        const tokenRecord = await pb.collection("notificationTopicTokens").getOne(tokenId);
        const topicRecord = await pb.collection("notificationTopics").getOne(tokenRecord.topic);
        if (!topicRecord || topicRecord.userId !== userId) {
            return NextResponse.json({ error: "Token not found or not owned by user" }, { status: 404 });
        }

        // --- 4. Delete token
        await pb.collection("notificationTopicTokens").delete(tokenId);

        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error("Error in DELETE /notificationTopicTokens:", err);
        return NextResponse.json({ error: "Internal Server Error", details: err.message }, { status: 500 });
    }
}
