import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
let activePull: Promise<void> | null = null;

async function runPullIconsScript() {
  const scriptPath = join(process.cwd(), "scripts", "icons.sh");
  const { stdout, stderr } = await execFileAsync("sh", [scriptPath], {
    cwd: process.cwd(),
    maxBuffer: 10 * 1024 * 1024,
  });

  if (stdout) {
    console.log(`[Action] pullIcons stdout:\n${stdout}`);
  }
  if (stderr) {
    console.warn(`[Action] pullIcons stderr:\n${stderr}`);
  }
}

export async function runPullIcons() {
  const start = new Date();

  if (activePull) {
    return {
      status: "busy",
      message: "pullIcons job is already running",
      _status: 409,
    };
  }

  activePull = (async () => {
    await runPullIconsScript();
  })();

  try {
    await activePull;
    const end = new Date();

    return {
      status: "success",
      startedAt: start.toISOString(),
      finishedAt: end.toISOString(),
    };
  } finally {
    activePull = null;
  }
}
