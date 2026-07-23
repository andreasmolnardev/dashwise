import { config } from "../../lib/config";
import { newsFeedBuilder } from "./internal/feed-builder";
import newsRoute from "./internal/news.route";
import type { DashwiseBackendModule } from "../../platform/modules/types";

export const newsFeedBuilderJob = {
  id: "newsFeedBuilder",
  schedule: config.FEED_BUILDING_SCHEDULE,
  runOnStartup: true,
  run: (_source: string, ...args: unknown[]) => newsFeedBuilder(typeof args[0] === "string" ? args[0] : undefined),
};

export const newsModule = {
  id: "news",
  name: "News",
  routes: [newsRoute],
  jobs: [newsFeedBuilderJob],
} satisfies DashwiseBackendModule;
