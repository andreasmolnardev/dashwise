import { requireBearerAuth } from "@/lib/api/auth";
import { getServerPB, getSuperuserPB } from "@/lib/pb";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
    try {
        const pb = getServerPB();
        const superPb = await getSuperuserPB();

        // --- 1. Require Bearer auth
        const tokenHeader = requireBearerAuth(req);
        if (!tokenHeader) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        pb.authStore.save(tokenHeader, null);
        const authModel = await pb.collection("users").authRefresh();
        const userId = authModel?.record?.id;
        if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        // --- 2. Get all forwarders where topic belongs to the user
        const forwarders = await superPb.collection("notificationForwarders").getFullList({
            filter: `topic.userId = "${userId}"`,
        });

        // --- 3. Map to response format
        const items = forwarders.map((fwd: any) => ({
            id: fwd.id,
            topic: { id: fwd.topic },
            target: fwd.target,
            isActive: fwd.isActive ?? true,
            created: fwd.created ?? null,
            updated: fwd.updated ?? null,
        }));

        return NextResponse.json({ items });
    } catch (err: any) {
        console.error("Error in GET /notificationForwarders:", err);
        return NextResponse.json({ error: "Internal Server Error", details: err.message }, { status: 500 });
    }
}

// Create new forwarder
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
        const { topic, target, isActive } = body;

        if (!topic || !target) {
            return NextResponse.json({ error: "Missing topic or target" }, { status: 400 });
        }

        // --- 3. Resolve topic (ensure it belongs to the authed user)
        let topicRecord: any = null;
        try {
            topicRecord = await pb.collection("notificationTopics").getOne(topic);
            if (!topicRecord || topicRecord.userId !== userId) {
                return NextResponse.json({ error: "Topic not found or not owned by user" }, { status: 404 });
            }
        } catch (err) {
            return NextResponse.json({ error: "Topic not found", details: (err as any).message }, { status: 404 });
        }

        // --- 4. Create forwarder record
        const createPayload: any = {
            topic: topicRecord.id,
            target: target,
            isActive: isActive !== false, // default to true
        };

        const created = await pb.collection("notificationForwarders").create(createPayload);

        const createdExpanded = {
            ...created,
            topic: topicRecord,
        };

        return NextResponse.json({ item: createdExpanded }, { status: 201 });
    } catch (err: any) {
        console.error("Error in POST /notificationForwarders:", err);
        return NextResponse.json({ error: "Internal Server Error", details: err.message }, { status: 500 });
    }
}

// Update forwarder
export async function PUT(req: NextRequest) {
    try {
        const pb = getServerPB();

        // --- 1. Require Bearer auth
        const tokenHeader = requireBearerAuth(req);
        if (!tokenHeader) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        pb.authStore.save(tokenHeader, null);
        const authModel = await pb.collection("users").authRefresh();
        const userId = authModel?.record?.id;
        if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        // --- 2. Parse body
        const body = await req.json().catch(() => ({}));
        const { forwarderId, target, isActive } = body;

        if (!forwarderId) {
            return NextResponse.json({ error: "Missing forwarderId" }, { status: 400 });
        }

        // --- 3. Fetch forwarder and check ownership
        const forwarderRecord = await pb.collection("notificationForwarders").getOne(forwarderId);
        const topicRecord = await pb.collection("notificationTopics").getOne(forwarderRecord.topic);
        
        if (!topicRecord || topicRecord.userId !== userId) {
            return NextResponse.json({ error: "Forwarder not found or not owned by user" }, { status: 404 });
        }

        // --- 4. Build update payload
        const updatePayload: any = {};
        if (target !== undefined) updatePayload.target = target;
        if (isActive !== undefined) updatePayload.isActive = isActive;

        // --- 5. Update record
        const updated = await pb.collection("notificationForwarders").update(forwarderId, updatePayload);

        return NextResponse.json({ item: updated }, { status: 200 });
    } catch (err: any) {
        console.error("Error in PUT /notificationForwarders:", err);
        return NextResponse.json({ error: "Internal Server Error", details: err.message }, { status: 500 });
    }
}

// Delete forwarder
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

        // --- 2. Parse body for forwarder ID to delete
        const body = await req.json().catch(() => ({}));
        const { forwarderId } = body;
        if (!forwarderId) return NextResponse.json({ error: "Missing forwarderId" }, { status: 400 });

        // --- 3. Fetch forwarder and check ownership
        const forwarderRecord = await pb.collection("notificationForwarders").getOne(forwarderId);
        const topicRecord = await pb.collection("notificationTopics").getOne(forwarderRecord.topic);
        if (!topicRecord || topicRecord.userId !== userId) {
            return NextResponse.json({ error: "Forwarder not found or not owned by user" }, { status: 404 });
        }

        // --- 4. Delete forwarder
        await pb.collection("notificationForwarders").delete(forwarderId);

        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error("Error in DELETE /notificationForwarders:", err);
        return NextResponse.json({ error: "Internal Server Error", details: err.message }, { status: 500 });
    }
}