import { NextRequest, NextResponse } from "next/server";
import { enforceJobsBasicAuth } from "@/lib/jobs/basicAuth";
import { runPullIcons } from "@dashwise/sdk/data/misc";

export async function GET(req: NextRequest) {
	const authError = enforceJobsBasicAuth(req);
	if (authError) {
		return authError;
	}

	const start = new Date();

	console.log(`[API] Starting pullIcons job at ${start.toISOString()}`);

	try {
		const result = await runPullIcons();
		if ((result as any)?._status) {
			return NextResponse.json(
				{
					status: (result as any).status,
					message: (result as any).message,
				},
				{ status: (result as any)._status }
			);
		}

		const end = new Date();
		console.log(
			`[API] Finished pullIcons job at ${end.toISOString()} (duration: ${(
				(end.getTime() - start.getTime()) /
				1000
			).toFixed(2)}s)`
		);

		return NextResponse.json({
			...(result as object),
			startedAt: (result as any).startedAt ?? start.toISOString(),
			finishedAt: (result as any).finishedAt ?? end.toISOString(),
		});
	} catch (error) {
		console.error("[API] Error running pullIcons job:", error);

		return NextResponse.json(
			{
				status: "error",
				message: String(error),
			},
			{ status: 500 }
		);
	}
}
