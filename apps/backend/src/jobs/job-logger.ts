import { randomUUID } from "crypto";

import { createJobLog } from "@dashwise/sdk/data/superuser";
import { createLogger } from "../lib/logger";

type JobStatus = "started" | "success" | "error";

interface JobLogEntry {
  job: string;
  runId: string;
  status: JobStatus;
  message?: string | undefined;
  started?: string | undefined;
  updated?: string | undefined;
}

interface RunJobOptions {
  startMessage?: string;
  successMessage?: string;
  errorMessage?: string;
}

const logger = createLogger("JobLogger");

function formatTimestamp(date: Date): string {
  return date.toISOString().replace("T", " ");
}

async function writeLog(entry: JobLogEntry) {
  try {
    await createJobLog({
      job: entry.job,
      runId: entry.runId,
      status: entry.status,
      message: entry.message,
      started: entry.started,
      updated: entry.updated,
    });
  } catch (error) {
    logger.error(`Failed to write job log for ${entry.job} (${entry.status})`, error);
  }
}

export async function runJob<T>(
  jobName: string,
  jobFn: () => Promise<T>,
  options: RunJobOptions = {}
): Promise<T> {
  const runId = randomUUID();
  const startTime = new Date();
  const startTimestamp = formatTimestamp(startTime);

  await writeLog({
    job: jobName,
    runId,
    status: "started",
    message: options.startMessage,
    started: startTimestamp,
    updated: startTimestamp,
  });

  try {
    const result = await jobFn();
    await writeLog({
      job: jobName,
      runId,
      status: "success",
      message: options.successMessage,
      started: startTimestamp,
      updated: formatTimestamp(new Date()),
    });
    return result;
  } catch (error: any) {
    const message = options.errorMessage ?? (error?.message || String(error));
    await writeLog({
      job: jobName,
      runId,
      status: "error",
      message,
      started: startTimestamp,
      updated: formatTimestamp(new Date()),
    });
    throw error;
  }
}