import { NextRequest, NextResponse } from "next/server";
import { authenticateUserId, getUserNewsFeedRecord } from "../_shared";

export async function GET(req: NextRequest) {
	try {
		const userId = await authenticateUserId(req);
		if (!userId) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const record = await getUserNewsFeedRecord(userId);

		return NextResponse.json(
			{
				id: record?.id ?? null,
				subscriptions: record?.subscriptions ?? [],
			},
			{ status: 200 }
		);
	} catch (err: any) {
		console.error("Error in GET /api/v1/news/subscriptions:", err);
		return NextResponse.json(
			{ error: "Internal Server Error", details: String(err?.message ?? err) },
			{ status: 500 }
		);
	}
}
