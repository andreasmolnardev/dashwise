import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { runJob } from "./job-logger";
import { config } from "../lib/config";
import { _d } from "../lib/sdk";
import { runSearchItemsIndexing } from "../platform/search/internal/service";
import { runVersionComparisonRunner } from "./updates/comparison-runner";
import { runIntegrationUpdaterJob } from "./updates/integration-updater";
import { runDefaultIntegrationsBootstrapJob } from "./updates/default-integrations";
import { createLogger } from "../lib/logger";
import { newsFeedBuilderJob } from "../modules/news/module";
import { monitoringIndexerJob, monitoringRunnerJob } from "../modules/monitoring/module";
import { notificationForwarderJob } from "../modules/notifications/module";
import type { DashwiseBackendModule } from "../platform/modules/types";

const execFileAsync = promisify(execFile);
const logger = createLogger("Jobs");

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
  runJob(monitoringIndexerJob.id, () => monitoringIndexerJob.run(), {
    startMessage: `Triggered by ${source}`,
    successMessage: "Status monitoring indexer completed",
    errorMessage: "Status monitoring indexer failed",
  });

const runMonitoringRunnerJob = (
  source: string,
  options?: { source?: string; linkId?: string },
) =>
  runJob(
    "statusMonitoringRunner",
    () => {
      return monitoringRunnerJob.run(source, options);
    },
    {
      startMessage: `Triggered by ${source}`,
      successMessage: "Status monitoring runner completed",
      errorMessage: "Status monitoring runner failed",
    },
  );

const runComparisonJob = (source: string) =>
  runJob("comparisonRunner", runVersionComparisonRunner, {
    startMessage: `Triggered by ${source}`,
    successMessage: "Comparison runner completed",
    errorMessage: "Comparison runner failed",
  });

const runIntegrationUpdateJob = (source: string) =>
  runJob("integrationUpdater", runIntegrationUpdaterJob, {
    startMessage: `Triggered by ${source}`,
    successMessage: "Integration updater completed",
    errorMessage: "Integration updater failed",
  });

const runDefaultIntegrationsJob = (source: string) =>
  runJob("defaultIntegrationsBootstrap", runDefaultIntegrationsBootstrapJob, {
    startMessage: `Triggered by ${source}`,
    successMessage: "Default integrations bootstrap completed",
    errorMessage: "Default integrations bootstrap failed",
  });

const runNewsFeedBuilderJob = (source: string, feedId?: string) =>
  runJob(newsFeedBuilderJob.id, () => newsFeedBuilderJob.run(source, feedId), {
    startMessage: `Triggered by ${source}${
      feedId ? ` for feed ${feedId}` : ""
    }`,
    successMessage: "News feed builder completed",
    errorMessage: "News feed builder failed",
  });

const runNotificationForwarderJob = (source: string) =>
  runJob(notificationForwarderJob.id, () => notificationForwarderJob.run(), {
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
    return email === config.PB_ADMIN_EMAIL &&
      password === config.PB_ADMIN_PASSWORD;
  } catch {
    return false;
  }
}

export async function dispatchEnabledModuleJob(
  modules: readonly DashwiseBackendModule[],
  jobId: string,
  source: string,
  ...args: unknown[]
) {
  const job = modules.flatMap((module) => module.jobs ?? []).find((candidate) => candidate.id === jobId);
  if (!job) return null;

  return runJob(job.id, () => job.run(source, ...args), {
    startMessage: `Triggered by ${source}`,
    successMessage: `${job.id} completed`,
    errorMessage: `${job.id} failed`,
  });
}

export function registerJobsCron(enabledModules: readonly { id: string }[]) {
  logger.debug("Dashwise SDK app config", _d.getAppConfig());
  const isEnabled = (moduleId: string) => enabledModules.some((module) => module.id === moduleId);

  void runSearchItemsJob("server start");
  Bun.cron(config.SEARCHITEMS_SCHEDULE, async () => {
    await runSearchItemsJob("cron schedule");
  });

  if (config.ENABLE_ICONS_REFRESH) {
    Bun.cron(config.PULL_ICONS_SCHEDULE, async () => {
      await runPullIconsJob("cron schedule");
    });
  }

  if (isEnabled("monitoring")) {
    Bun.cron(monitoringIndexerJob.schedule, async () => {
      await runMonitoringIndexerJob("cron schedule");
    });
    Bun.cron(monitoringRunnerJob.schedule, async () => {
      await runMonitoringRunnerJob("cron schedule");
    });
  }

  void runComparisonJob("initial run");
  void runIntegrationUpdateJob("initial run");
  void runDefaultIntegrationsJob("initial run");
  Bun.cron(config.UPDATE_CHECK_SCHEDULE, async () => {
    await runComparisonJob("scheduled run");
    await runIntegrationUpdateJob("scheduled run");
  });

  Bun.cron(config.DEFAULT_INTEGRATIONS_SCHEDULE, async () => {
    await runDefaultIntegrationsJob("scheduled run");
  });

  if (isEnabled("news")) {
    if (newsFeedBuilderJob.runOnStartup) void runNewsFeedBuilderJob("initial run");
    Bun.cron(newsFeedBuilderJob.schedule, async () => {
      await runNewsFeedBuilderJob("scheduled run");
    });
  }

  if (isEnabled("notifications")) {
    Bun.cron(notificationForwarderJob.schedule, async () => {
      await runNotificationForwarderJob("cron schedule");
    });
  }
}

export const jobsApi = {
  runSearchItemsJob,
  runPullIconsJob,
  runMonitoringIndexerJob,
  runMonitoringRunnerJob,
  runComparisonJob,
  runIntegrationUpdateJob,
  runDefaultIntegrationsJob,
  runNewsFeedBuilderJob,
  runNotificationForwarderJob,
};
