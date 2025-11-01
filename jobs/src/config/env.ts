import * as dotenv from "dotenv";
dotenv.config();

const processAllowSsl = process.env.ALLOW_SSL;

export const config = {
  PB_URL: process.env.PB_URL!,
  SEARCHITEMS_SCHEDULE: process.env.SEARCHITEMS_SCHEDULE || "*/10 * * * *",
  MONITORING_INDEXER_SCHEDULE: process.env.MONITORING_INDEXER_SCHEDULE || "*/10 * * * *",
  MONITORING_RUNNER_SCHEDULE: process.env.MONITORING_RUNNER_SCHEDULE || "*/1 * * * *",
  UPDATE_CHECK_SCHEDULE:  process.env.UPDATE_CHECK_SCHEDULE || "0 2 * * *",
  ALLOW_SSL: processAllowSsl == "true" || processAllowSsl == "1",
  PB_ADMIN_EMAIL: process.env.PB_ADMIN_EMAIL!,
  PB_ADMIN_PASSWORD: process.env.PB_ADMIN_PASSWORD!,
  DASHWISE_URL: process.env.DASHWISE_URL || undefined,
  DASHWISE_VERSION: '0.2',
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
