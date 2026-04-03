import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import cron from "node-cron";
import { runJob } from "./lib/job-logger";
import { config } from "../config/env";
import { _d } from "../lib/sdk";
import { runSearchItemsIndexing } from "./search-indexer";
import indexStatusMonitoringJobs from "./monitoring/indexer";
import { runStatusMonitoringJobs, runStatusMonitoringJobsWithOptions } from "./monitoring/runner";
import { runVersionComparisonRunner } from "./updates/comparison-runner";
import { newsFeedBuilder } from "./news/feed-builder";
import { processQueuedNotifications } from "./notifications/forwarder";

const execFileAsync = promisify(execFile);

async function runSearchIndexerScript() {
  await runSearchItemsIndexing();
}

async function runPullIconsScript() {
  await execFileAsync("sh", ["apps/web/scripts/icons.sh"], {
    cwd: process.cwd(),
    maxBuffer: 10 * 1024 * 1024,
  });
}

const runSearchItemsJob = (source: string) =>
  runJob("searchItemsIndexer", runSearchIndexerScript, {
    startMessage: `Triggered by ${source}`,
    successMessage: "Search items indexing completed",
    errorMessage: "Search items indexing failed",
  });

const runPullIconsJob = (source: string) =>
  runJob("pullIcons", runPullIconsScript, {
    startMessage: `Triggered by ${source}`,
    successMessage: "Pull icons job completed",
    errorMessage: "Pull icons job failed",
  });

const runMonitoringIndexerJob = (source: string) =>
  runJob("statusMonitoringIndexer", indexStatusMonitoringJobs, {
    startMessage: `Triggered by ${source}`,
    successMessage: "Status monitoring indexer completed",
    errorMessage: "Status monitoring indexer failed",
  });

const runMonitoringRunnerJob = (source: string, options?: { source?: string; linkId?: string }) =>
  runJob(
    "statusMonitoringRunner",
    () => {
      if (options?.source || options?.linkId) {
        return runStatusMonitoringJobsWithOptions(options);
      }
      return runStatusMonitoringJobs();
    },
    {
      startMessage: `Triggered by ${source}`,
      successMessage: "Status monitoring runner completed",
      errorMessage: "Status monitoring runner failed",
    }
  );

const runComparisonJob = (source: string) =>
  runJob("comparisonRunner", runVersionComparisonRunner, {
    startMessage: `Triggered by ${source}`,
    successMessage: "Comparison runner completed",
    errorMessage: "Comparison runner failed",
  });

const runNewsFeedBuilderJob = (source: string, feedId?: string) =>
  runJob("newsFeedBuilder", () => newsFeedBuilder(feedId), {
    startMessage: `Triggered by ${source}${feedId ? ` for feed ${feedId}` : ""}`,
    successMessage: "News feed builder completed",
    errorMessage: "News feed builder failed",
  });

const runNotificationForwarderJob = (source: string) =>
  runJob("notificationForwarder", processQueuedNotifications, {
    startMessage: `Triggered by ${source}`,
    successMessage: "Notification forwarder completed",
    errorMessage: "Notification forwarder failed",
  });

export function validateJobsBasicAuth(authorizationHeader: string | undefined) {
  if (!authorizationHeader?.toLowerCase().startsWith("basic ")) {
    return false;
  }

  const encoded = authorizationHeader.slice(6).trim();
  if (!encoded) return false;

  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf-8");
    const [email, password] = decoded.split(":", 2);
    return email === config.PB_ADMIN_EMAIL && password === config.PB_ADMIN_PASSWORD;
  } catch {
    return false;
  }
}

export function registerJobsCron() {
  console.log("dashwise job runner is active");
  console.log("Dashwise SDK app config:", _d.getAppConfig());

  cron.schedule(config.SEARCHITEMS_SCHEDULE, () => {
    void runSearchItemsJob("cron schedule");
  });

  if (config.ENABLE_ICONS_REFRESH) {
    cron.schedule(config.PULL_ICONS_SCHEDULE, () => {
      void runPullIconsJob("cron schedule");
    });
  }

  cron.schedule(config.MONITORING_INDEXER_SCHEDULE, () => {
    void runMonitoringIndexerJob("cron schedule");
  });

  cron.schedule(config.MONITORING_RUNNER_SCHEDULE, () => {
    void runMonitoringRunnerJob("cron schedule");
  });

  void runComparisonJob("initial run");
  cron.schedule(config.UPDATE_CHECK_SCHEDULE, () => {
    void runComparisonJob("scheduled run");
  });

  void runNewsFeedBuilderJob("initial run");
  cron.schedule(config.FEED_BUILDING_SCHEDULE, () => {
    void runNewsFeedBuilderJob("scheduled run");
  });

  cron.schedule(config.NOTIFICATION_FORWARDER_SCHEDULE, () => {
    void runNotificationForwarderJob("cron schedule");
  });
}

export const jobsApi = {
  runSearchItemsJob,
  runPullIconsJob,
  runMonitoringIndexerJob,
  runMonitoringRunnerJob,
  runNewsFeedBuilderJob,
  runNotificationForwarderJob,
};