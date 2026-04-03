import runBackgroundJobs from "@/lib/jobs";
import { NextRequest, NextResponse } from "next/server";
import { enforceJobsBasicAuth } from "@/lib/jobs/basicAuth";

export async function GET(req: NextRequest) {
  const authError = enforceJobsBasicAuth(req);
  if (authError) {
    return authError;
  }
  const start = new Date();
  console.log(`[API] Starting background jobs at ${start.toISOString()}`);

  try {
    await runBackgroundJobs();
    const end = new Date();
    console.log(
      `[API] Finished background jobs at ${end.toISOString()} (duration: ${(
        (end.getTime() - start.getTime()) /
        1000
      ).toFixed(2)}s)`
    );

    return NextResponse.json({
      status: "success",
      startedAt: start.toISOString(),
      finishedAt: end.toISOString(),
    });
  } catch (err) {
    const end = new Date();
    console.error(`[API] Error running background jobs:`, err);

    return NextResponse.json(
      { status: "error", message: String(err) },
      { status: 500 }
    );
  }
}
