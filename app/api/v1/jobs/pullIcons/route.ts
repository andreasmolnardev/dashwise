import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";

const execFileAsync = promisify(execFile);

let activePull: Promise<void> | null = null;

async function runPullIconsScript() {
	const scriptPath = join(process.cwd(), "scripts", "icons.sh");
	const { stdout, stderr } = await execFileAsync("sh", [scriptPath], {
		cwd: process.cwd(),
		maxBuffer: 10 * 1024 * 1024,
	});

	if (stdout) {
		console.log(`[API] pullIcons stdout:\n${stdout}`);
	}

	if (stderr) {
		console.warn(`[API] pullIcons stderr:\n${stderr}`);
	}
}

export async function GET(_req: NextRequest) {
	const start = new Date();

	if (activePull) {
		return NextResponse.json(
			{
				status: "busy",
				message: "pullIcons job is already running",
			},
			{ status: 409 }
		);
	}

	console.log(`[API] Starting pullIcons job at ${start.toISOString()}`);

	activePull = (async () => {
		await runPullIconsScript();
	})();

	try {
		await activePull;

		const end = new Date();
		console.log(
			`[API] Finished pullIcons job at ${end.toISOString()} (duration: ${(
				(end.getTime() - start.getTime()) /
				1000
			).toFixed(2)}s)`
		);

		return NextResponse.json({
			status: "success",
			startedAt: start.toISOString(),
			finishedAt: end.toISOString(),
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
	} finally {
		activePull = null;
	}
}
