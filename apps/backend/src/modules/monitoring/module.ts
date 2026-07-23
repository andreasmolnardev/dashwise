import monitoringRoute from "./internal/monitoring.route";
import { config } from "../../lib/config";
import indexStatusMonitoringJobs from "../../jobs/monitoring/indexer";
import { runStatusMonitoringJobs, runStatusMonitoringJobsWithOptions } from "../../jobs/monitoring/runner";
import type { DashwiseBackendModule } from "../../platform/modules/types";

export const monitoringIndexerJob = {
  id: "statusMonitoringIndexer",
  schedule: config.MONITORING_INDEXER_SCHEDULE,
  run: () => indexStatusMonitoringJobs(),
};

export const monitoringRunnerJob = {
  id: "statusMonitoringRunner",
  schedule: config.MONITORING_RUNNER_SCHEDULE,
  run: (_source: string, ...args: unknown[]) => {
    const options = args[0] as { source?: string; linkId?: string } | undefined;
    return options ? runStatusMonitoringJobsWithOptions(options) : runStatusMonitoringJobs();
  },
};

export const monitoringModule = {
  id: "monitoring",
  name: "Monitoring",
  routes: [monitoringRoute],
  jobs: [monitoringIndexerJob, monitoringRunnerJob],
} satisfies DashwiseBackendModule;
