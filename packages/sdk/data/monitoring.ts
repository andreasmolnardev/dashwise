import axios from "axios";
import config from "@/lib/config";
import { getSuperuserPB } from "@dashwise/sdk/lib/pocketbase";

type JobStatusSummary = {
  status: string;
  dateChanged: string | null;
  durationChanged: number | null;
};

function normalizeStatus(rawStatus: unknown): string {
  if (Array.isArray(rawStatus)) {
    return String(rawStatus[0] || "unhealthy");
  }
  return String(rawStatus || "unhealthy");
}

async function getLatestJobStatus(pb: any, userId: string, job: any): Promise<JobStatusSummary> {
  const jobLogsResponse = await pb.collection("monitoringJobStatusLogs").getList(1, 2, {
    filter: `job = "${job.id}" && job.userId = "${userId}"`,
    sort: "-created",
  });

  const jobLogs = jobLogsResponse.items;
  let latestStatus = normalizeStatus(job.status);
  let dateChanged: string | null = null;
  let durationChanged: number | null = null;

  if (jobLogs && jobLogs.length > 0) {
    const latestLog = jobLogs[0];
    latestStatus = normalizeStatus(latestLog.status);
    dateChanged = latestLog.created;

    if (jobLogs.length > 1) {
      const secondLatestLog = jobLogs[1];
      durationChanged =
        (new Date(latestLog.created).getTime() - new Date(secondLatestLog.created).getTime()) /
        1000;
    }
  }

  return { status: latestStatus, dateChanged, durationChanged };
}

export async function getMonitoringStatus(userId: string, jobId?: string | null) {
  const pb = await getSuperuserPB();

  const monitoringJobs = jobId
    ? await pb
        .collection("monitoringJobs")
        .getFullList({ filter: `id = "${jobId}" && userId = "${userId}"` })
    : await pb.collection("monitoringJobs").getFullList({ filter: `userId = "${userId}"` });

  if (!monitoringJobs || monitoringJobs.length === 0) {
    return {};
  }

  const results: Record<
    string,
    { status: string; dateChanged: string | null; durationChanged: number | null; endpoint?: string }
  > = {};

  for (const job of monitoringJobs) {
    const statusSummary = await getLatestJobStatus(pb, userId, job);
    results[job.source] = {
      status: statusSummary.status,
      dateChanged: statusSummary.dateChanged,
      durationChanged: statusSummary.durationChanged,
      endpoint: job.endpoint,
    };
  }

  return results;
}

export async function runMonitoringStatus(userId: string, body: any) {
  const pb = await getSuperuserPB();

  const linkId = typeof body?.linkId === "string" ? body.linkId.trim() : "";
  const jobId = typeof body?.jobId === "string" ? body.jobId.trim() : "";

  if (!linkId && !jobId) {
    return { _status: 400, error: "Missing target identifier: provide linkId or jobId" };
  }

  const targetFilter = jobId
    ? `id = "${jobId}" && userId = "${userId}"`
    : `source = "link ${linkId}" && userId = "${userId}"`;

  const existingJobs = await pb.collection("monitoringJobs").getFullList({ filter: targetFilter });
  if (!existingJobs || existingJobs.length === 0) {
    return { _status: 404, error: "Monitoring job not found for this user" };
  }

  if (!config.jobs_webhook_enabled) {
    return { _status: 400, error: "Jobs webhook is disabled" };
  }

  const targetJob = existingJobs[0];
  const source = String(targetJob.source || (linkId ? `link ${linkId}` : ""));
  const sourceLinkId = source.startsWith("link ") ? source.slice(5) : undefined;

  const webhookUrl = `${config.jobs_url}/webhook/statusMonitoringRunner${
    sourceLinkId ? `?linkId=${encodeURIComponent(sourceLinkId)}` : ""
  }`;
  const webhookResponse = await axios.get(webhookUrl);

  const refreshedJobs = await pb
    .collection("monitoringJobs")
    .getFullList({ filter: `id = "${targetJob.id}" && userId = "${userId}"` });
  const refreshedJob = refreshedJobs[0] || targetJob;
  const statusSummary = await getLatestJobStatus(pb, userId, refreshedJob);

  const runnerDetails = webhookResponse?.data?.result?.details;
  const matchingRunnerDetail = Array.isArray(runnerDetails)
    ? runnerDetails.find((entry: any) => entry?.jobId === refreshedJob.id) || runnerDetails[0]
    : undefined;

  const normalizedStatus = normalizeStatus(statusSummary.status);
  const statusForUi =
    normalizedStatus === "healthy"
      ? "up"
      : normalizedStatus === "disabled"
        ? "disabled"
        : "down";

  return {
    jobId: refreshedJob.id,
    linkId: sourceLinkId,
    source,
    status: statusForUi,
    rawStatus: normalizedStatus,
    endpoint: refreshedJob.endpoint,
    checkedAt: new Date().toISOString(),
    dateChanged: statusSummary.dateChanged,
    durationChanged: statusSummary.durationChanged,
    httpStatus: matchingRunnerDetail?.httpStatus,
    method: matchingRunnerDetail?.method,
    result: matchingRunnerDetail,
    webhookResult: webhookResponse?.data,
  };
}
