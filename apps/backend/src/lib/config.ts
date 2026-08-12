import { readFileSync } from "node:fs";

const env = Bun.env;

const dashwiseVersion = readFileSync(new URL("../../../../VERSION", import.meta.url), "utf8").trim();

const processAllowSsl = env.ALLOW_SSL;
const processEnvironment = env.ENVIRONMENT;
const processStartPocketBase = env.START_POCKETBASE;
const processOutlierType = env.MONITORING_OUTLIER_THRESHOLD_TYPE;
const processOutlierValue = env.MONITORING_OUTLIER_THRESHOLD_VALUE;

const normalizedOutlierType = processOutlierType === "absolute" ? "absolute" : "relative";
const normalizedOutlierValue = Number(processOutlierValue);
const fallbackOutlierValue = normalizedOutlierType === "absolute" ? 500 : 50;
const resolvedOutlierValue = Number.isFinite(normalizedOutlierValue) && normalizedOutlierValue > 0
  ? normalizedOutlierValue
  : fallbackOutlierValue;

const truthyEnv = (value?: string | null): boolean => {
  if (!value) return false;
  return value === "1" || value.toLowerCase() === "true";
};

const requestedLocalFeedCache = truthyEnv(env.USE_LOCAL_FEED_CACHE);
const useLocalFeedCache = requestedLocalFeedCache && processEnvironment === "dev";

if (requestedLocalFeedCache && !useLocalFeedCache) {
  console.warn("USE_LOCAL_FEED_CACHE is only supported in development and will be ignored");
}

/**
 * Get env var with NEXT_PUBLIC_ fallback for backend compatibility.
 * Backend can use either the non-prefixed or NEXT_PUBLIC_ version.
 */
const getEnv = (name: string, nextPublicName?: string): string | undefined => {
  return env[name] ?? (nextPublicName ? env[nextPublicName] : undefined);
};

// Helper to get log level with NEXT_PUBLIC_ fallback
const getLogLevel = (): string | undefined => {
  return env.LOG_LEVEL ?? env.BACKEND_LOG_LEVEL;
};

export const config = {
  ENVIRONMENT: processEnvironment === "dev" ? "dev" : "production",
  USE_LOCAL_FEED_CACHE: useLocalFeedCache,
  PORT: Number(env.PORT) || 3000,
  PB_URL: getEnv("PB_URL", "NEXT_PUBLIC_PB_URL") || "http://127.0.0.1:8090",
  PB_BINARY_PATH: env.PB_BINARY_PATH,
  LOG_LEVEL: getLogLevel(),
  START_POCKETBASE:
    processStartPocketBase == null
      ? true
      : !(processStartPocketBase === "false" || processStartPocketBase === "0"),
  SEARCHITEMS_SCHEDULE: env.SEARCHITEMS_SCHEDULE || "*/10 * * * *",
  ENABLE_ICONS_REFRESH: env.ENABLE_ICONS_REFRESH === "true",
  PULL_ICONS_SCHEDULE: env.PULL_ICONS_SCHEDULE || "0 */18 * * *",
  MONITORING_INDEXER_SCHEDULE: env.MONITORING_INDEXER_SCHEDULE || "*/10 * * * *",
  MONITORING_RUNNER_SCHEDULE: env.MONITORING_RUNNER_SCHEDULE || "*/1 * * * *",
  UPDATE_CHECK_SCHEDULE: env.UPDATE_CHECK_SCHEDULE || "0 2 * * *",
  FEED_BUILDING_SCHEDULE: env.FEED_BUILDING_SCHEDULE || "*/30 * * * *",
  NOTIFICATION_FORWARDER_SCHEDULE: env.NOTIFICATION_FORWARDER_SCHEDULE || "* * * * *",
  DEFAULT_INTEGRATIONS_SCHEDULE: env.DEFAULT_INTEGRATIONS_SCHEDULE || "0 4 * * *",
  PAGECONFIG_CLEANUP_SCHEDULE: env.PAGECONFIG_CLEANUP_SCHEDULE || "0 5 * * *",
  MONITORING_OUTLIER_THRESHOLD_TYPE: normalizedOutlierType,
  MONITORING_OUTLIER_THRESHOLD_VALUE: resolvedOutlierValue,
  JOBS_MONITORING_RETRY_AFTER: Number(env.JOBS_MONITORING_RETRY_AFTER) || 5000,
  ALLOW_SSL: processAllowSsl == "true" || processAllowSsl == "1",
  PB_ADMIN_EMAIL: env.PB_ADMIN_EMAIL!,
  PB_ADMIN_PASSWORD: env.PB_ADMIN_PASSWORD,
  DASHWISE_URL: env.DASHWISE_URL || (processEnvironment === "dev" ? "http://localhost:3000" : ""),
  APP_BASE_URL: getEnv("APP_BASE_URL", "NEXT_PUBLIC_APP_URL") || env.DASHWISE_URL || (processEnvironment === "dev" ? "http://localhost:3000" : ""),
  DASHWISE_VERSION: dashwiseVersion || "development",
  GITHUB_REPO: 'andreasmolnardev/dashwise-next',
  INSTANCE_NAME: getEnv("INSTANCE_NAME", "NEXT_PUBLIC_INSTANCE_NAME") || "Dashwise",
  DISABLE_USER_SIGNUP: truthyEnv(getEnv("DISABLE_USER_SIGNUP", "NEXT_PUBLIC_DISABLE_USER_SIGNUP")),
  ENABLE_SSO: truthyEnv(getEnv("ENABLE_SSO", "NEXT_PUBLIC_ENABLE_SSO")),
  JOBS_URL: getEnv("JOBS_URL", "NEXT_PUBLIC_JOBS_URL") || "http://127.0.0.1:3001",
  JOBS_WEBHOOK_URL: env.JOBS_WEBHOOK_URL || "http://jobs:3000/api/forward-notifications",
  JOBS_WEBHOOK_ENABLED: truthyEnv(getEnv("JOBS_WEBHOOK_ENABLE", "NEXT_PUBLIC_JOBS_WEBHOOK_ENABLE")) || !!getEnv("JOBS_URL", "NEXT_PUBLIC_JOBS_URL"),
  DEFAULT_BG_URL: getEnv("DEFAULT_BG_URL", "NEXT_PUBLIC_DEFAULT_BG_URL") || "/dashboard-wallpaper.png",
  allowInsecureCertsForIntegrationUrls: truthyEnv(getEnv("ALLOW_INSECURE_CERTS_FOR_INTEGRATION_URLS", "NEXT_PUBLIC_INTEGRATIONS_ENABLE_SSL")) || truthyEnv(env.ALLOW_SSL),
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
