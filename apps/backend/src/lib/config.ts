const env = Bun.env;

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

export const config = {
  ENVIRONMENT: processEnvironment === "dev" ? "dev" : "production",
  PB_URL: env.PB_URL || "http://127.0.0.1:8090",
  START_POCKETBASE:
    processStartPocketBase == null
      ? true
      : !(processStartPocketBase === "false" || processStartPocketBase === "0"),
  SEARCHITEMS_SCHEDULE: env.SEARCHITEMS_SCHEDULE || "*/10 * * * *",
  ENABLE_ICONS_REFRESH: env.ENABLE_ICONS_REFRESH === "true",
  PULL_ICONS_SCHEDULE: env.PULL_ICONS_SCHEDULE || "0 */18 * * *",
  MONITORING_INDEXER_SCHEDULE: env.MONITORING_INDEXER_SCHEDULE || "*/10 * * * *",
  MONITORING_RUNNER_SCHEDULE: env.MONITORING_RUNNER_SCHEDULE || "*/1 * * * *",
  UPDATE_CHECK_SCHEDULE:  env.UPDATE_CHECK_SCHEDULE || "0 2 * * *",
  FEED_BUILDING_SCHEDULE: env.FEED_BUILDING_SCHEDULE || "*/30 * * * *",
  NOTIFICATION_FORWARDER_SCHEDULE: env.NOTIFICATION_FORWARDER_SCHEDULE || "* * * * *",
  DEFAULT_INTEGRATIONS_SCHEDULE: env.DEFAULT_INTEGRATIONS_SCHEDULE || "0 4 * * *",
  PAGECONFIG_CLEANUP_SCHEDULE: env.PAGECONFIG_CLEANUP_SCHEDULE || "0 5 * * *",
  MONITORING_OUTLIER_THRESHOLD_TYPE: normalizedOutlierType,
  MONITORING_OUTLIER_THRESHOLD_VALUE: resolvedOutlierValue,
  ALLOW_SSL: processAllowSsl == "true" || processAllowSsl == "1",
  PB_ADMIN_EMAIL: env.PB_ADMIN_EMAIL!,
  PB_ADMIN_PASSWORD: env.PB_ADMIN_PASSWORD,
  DASHWISE_URL: env.DASHWISE_URL || (processEnvironment === "dev" ? "http://localhost:3000" : ""),
  APP_BASE_URL: env.APP_BASE_URL || env.DASHWISE_URL || (processEnvironment === "dev" ? "http://localhost:3000" : ""),
  DASHWISE_VERSION: '1.0',
  GITHUB_REPO: 'andreasmolnardev/dashwise-next',
  INSTANCE_NAME: env.INSTANCE_NAME || "Dashwise",
  DISABLE_USER_SIGNUP: truthyEnv(env.DISABLE_USER_SIGNUP),
  ENABLE_SSO: truthyEnv(env.ENABLE_SSO),
  JOBS_URL: env.JOBS_URL || "http://127.0.0.1:3001",
  JOBS_WEBHOOK_ENABLED: truthyEnv(env.JOBS_WEBHOOK_ENABLE) || !!env.JOBS_URL,
  DEFAULT_BG_URL: env.DEFAULT_BG_URL || "/dashboard-wallpaper.png",
  allowInsecureCertsForIntegrationUrls: truthyEnv(env.ALLOW_INSECURE_CERTS_FOR_INTEGRATION_URLS) || false,
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
