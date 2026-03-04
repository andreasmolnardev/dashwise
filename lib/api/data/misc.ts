import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

const execFileAsync = promisify(execFile);
let activePull: Promise<void> | null = null;

export async function getLocations(q?: string | null) {
  if (!q) return [];

  const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
    q
  )}&limit=6`;

  const response = await fetch(nominatimUrl, {
    headers: { "User-Agent": "my-homelab-dashboard/1.0" },
  });

  return response.json();
}

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
