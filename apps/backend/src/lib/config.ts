import * as dotenv from "dotenv";
dotenv.config();

const processAllowSsl = process.env.ALLOW_SSL;
const processStartPocketBase = process.env.START_POCKETBASE;
const processOutlierType = process.env.MONITORING_OUTLIER_THRESHOLD_TYPE;
const processOutlierValue = process.env.MONITORING_OUTLIER_THRESHOLD_VALUE;

const normalizedOutlierType = processOutlierType === "absolute" ? "absolute" : "relative";
const normalizedOutlierValue = Number(processOutlierValue);
const fallbackOutlierValue = normalizedOutlierType === "absolute" ? 500 : 50;
const resolvedOutlierValue = Number.isFinite(normalizedOutlierValue) && normalizedOutlierValue > 0
  ? normalizedOutlierValue
  : fallbackOutlierValue;

export const config = {
  PB_URL: process.env.PB_URL || "http://127.0.0.1:8090",
  START_POCKETBASE:
    processStartPocketBase == null
      ? true
      : !(processStartPocketBase === "false" || processStartPocketBase === "0"),
  SEARCHITEMS_SCHEDULE: process.env.SEARCHITEMS_SCHEDULE || "*/10 * * * *",
  ENABLE_ICONS_REFRESH: process.env.ENABLE_ICONS_REFRESH === "true",
  PULL_ICONS_SCHEDULE: process.env.PULL_ICONS_SCHEDULE || "0 */18 * * *",
  MONITORING_INDEXER_SCHEDULE: process.env.MONITORING_INDEXER_SCHEDULE || "*/10 * * * *",
  MONITORING_RUNNER_SCHEDULE: process.env.MONITORING_RUNNER_SCHEDULE || "*/1 * * * *",
  UPDATE_CHECK_SCHEDULE:  process.env.UPDATE_CHECK_SCHEDULE || "0 2 * * *",
  FEED_BUILDING_SCHEDULE: process.env.FEED_BUILDING_SCHEDULE || "*/30 * * * *",
  NOTIFICATION_FORWARDER_SCHEDULE: process.env.NOTIFICATION_FORWARDER_SCHEDULE || "* * * * *",
  MONITORING_OUTLIER_THRESHOLD_TYPE: normalizedOutlierType,
  MONITORING_OUTLIER_THRESHOLD_VALUE: resolvedOutlierValue,
  ALLOW_SSL: processAllowSsl == "true" || processAllowSsl == "1",
  PB_ADMIN_EMAIL: process.env.PB_ADMIN_EMAIL!,
  PB_ADMIN_PASSWORD: process.env.PB_ADMIN_PASSWORD,
  DASHWISE_URL: process.env.DASHWISE_URL || "http://localhost:3000",
  DASHWISE_VERSION: '1.0',
  GITHUB_REPO: 'andreasmolnardev/dashwise-next'
} as const;

export type Config = typeof config;

// Only check for the *required* ones
const requiredKeys: (keyof Config)[] = [
  "PB_URL",
  "PB_ADMIN_EMAIL",
  "PB_ADMIN_PASSWORD",
];

for (const key of requiredKeys) {
  if (!config[key]) throw new Error(`Missing required environment variable: ${key}`);
}
