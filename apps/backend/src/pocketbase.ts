import { accessSync, constants, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getSuperuserPB } from "@dashwise/sdk/lib/pocketbase";
import { config } from "./lib/config";
import { createLogger, setPocketBaseLogger } from "./lib/logger";

/**
 * Resolve current file directory (ESM-safe)
 */
const __dirname = fileURLToPath(new URL(".", import.meta.url));
const logger = createLogger("PocketBase");

type PocketBaseClient = Awaited<ReturnType<typeof getSuperuserPB>>;

export type PocketBaseStartResult = {
  process: Bun.Subprocess | null;
  pb: PocketBaseClient;
};

/**
 * Walk up until we find monorepo root (pnpm workspace marker)
 */
function findRepoRoot(start: string): string {
  let dir = start;

  while (!existsSync(resolve(dir, ".root.ind"))) {
    const parent = resolve(dir, "..");
    if (parent === dir) {
      throw new Error("Monorepo root not found");
    }
    dir = parent;
  }

  return dir;
}

/**
 * Ensure binary exists AND is executable
 */
function isExecutable(path: string) {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve PocketBase binary
 */
function resolvePocketBaseRuntimePath() {
  const candidates = [
    process.env.PB_BINARY_PATH,
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (existsSync(candidate) && isExecutable(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    "PocketBase binary not found or not executable. Set PB_BINARY_PATH correctly.",
  );
}

async function waitForPocketBaseReady(healthUrl: string, pb?: Bun.Subprocess) {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    if (pb && pb.exitCode !== null) {
      throw new Error(
        `PocketBase exited before becoming ready (code ${pb.exitCode})`,
      );
    }

    try {
      const response = await fetch(healthUrl);

      if (response.ok) {
        return;
      }
    } catch {
      // Keep retrying until PocketBase is ready or the process exits.
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out waiting for PocketBase readiness at ${healthUrl}`);
}

export async function startPocketbase(): Promise<PocketBaseStartResult> {
  const healthUrl = new URL("/api/health", config.PB_URL).toString();

  if (!config.START_POCKETBASE) {
    logger.info(`Using configured PocketBase at ${config.PB_URL}`);
    await waitForPocketBaseReady(healthUrl);
    const pb = await getSuperuserPB();
    const pbLogger =
      (pb as { logger?: () => Parameters<typeof setPocketBaseLogger>[0] })
        .logger?.();
    if (pbLogger) {
      setPocketBaseLogger(pbLogger);
    }
    return { process: null, pb };
  }

  const monorepoRoot = findRepoRoot(__dirname);
  const pocketBaseRoot = resolve(monorepoRoot, "pocketbase");

  const dataDir = resolve(pocketBaseRoot, "pb_data");
  const migrationsDir = resolve(pocketBaseRoot, "migrations");
  console.log("Resolved PocketBase paths", { dataDir, migrationsDir });

  const pocketBaseBinary = resolvePocketBaseRuntimePath();

  if (!config.PB_ADMIN_EMAIL || !config.PB_ADMIN_PASSWORD) {
    throw new Error("Missing PocketBase admin credentials");
  }

  logger.info(`Binary found at ${pocketBaseBinary}`);
  logger.debug("PocketBase paths", {
    binary: pocketBaseBinary,
    dataDir,
    migrationsDir,
  });

  const createSuperuser = Bun.spawnSync([
    pocketBaseBinary,
    "superuser",
    "upsert",
    `${config.PB_ADMIN_EMAIL}`,
    `${config.PB_ADMIN_PASSWORD}`,
    `--dir=${dataDir}`,
  ]);

  if (createSuperuser.exitCode !== 0) {
    const stderr = new TextDecoder().decode(createSuperuser.stderr);
    const stdout = new TextDecoder().decode(createSuperuser.stdout);
    logger.error("Superuser creation failed", {
      stderr,
      stdout,
      exitCode: createSuperuser.exitCode,
    });
    throw new Error(`Failed to create superuser: ${stderr || stdout}`);
  } else {
    logger.info("Superuser created or already exists");
  }

  // Start PocketBase
  const pb = Bun.spawn(
    [
      pocketBaseBinary,
      "serve",
      "--http=0.0.0.0:8090",
      `--dir=${dataDir}`,
      `--migrationsDir=${migrationsDir}`,
    ],
    {
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  // Forward Ctrl+C and kill PB
  const shutdown = () => {
    logger.info("Shutting down PocketBase");
    pb.kill();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await waitForPocketBaseReady(healthUrl, pb);

  const pbClient = await getSuperuserPB();
  const pbLogger =
    (pbClient as { logger?: () => Parameters<typeof setPocketBaseLogger>[0] })
      .logger?.();
  if (pbLogger) {
    setPocketBaseLogger(pbLogger);
  }

  return { process: pb, pb: pbClient };
}
