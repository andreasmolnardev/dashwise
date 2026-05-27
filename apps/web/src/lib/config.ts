interface Config {
  backend_url: string;
  pb_url: string;
  jobs_url?: string | undefined;
  jobs_webhook_enabled: boolean;
  default_bg_url: string;
  version: string;
  allowInsecureCertsForIntegrationUrls: boolean;
  enableSSO: boolean;
  disableUserSignup: boolean;
}

const env = ((typeof import.meta !== "undefined" && import.meta.env) ? import.meta.env : {}) as Record<
  string,
  string | undefined
>;
declare const __DEV__: boolean;

const isDev = typeof __DEV__ !== "undefined" && __DEV__;

const allowInsecureCertsForIntegrationUrls =
  env.NEXT_PUBLIC_INTEGRATIONS_ENABLE_SSL === "true" ||
  env.NEXT_PUBLIC_INTEGRATIONS_ENABLE_SSL === "1";

const enableSSOLogin =
  env.NEXT_PUBLIC_ENABLE_SSO === "true" || env.NEXT_PUBLIC_ENABLE_SSO === "1" || false;

const disableUserSignup =
  env.NEXT_PUBLIC_DISABLE_USER_SIGNUP === "true" || env.NEXT_PUBLIC_DISABLE_USER_SIGNUP === "1" || false;

const enableJobsWebhook =
  env.NEXT_PUBLIC_JOBS_WEBHOOK_ENABLE === "true" ||
  env.NEXT_PUBLIC_JOBS_WEBHOOK_ENABLE === "1" ||
  !!env.NEXT_PUBLIC_JOBS_URL ||
  false;

const backendUrl = env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3000";

const config: Config = {
  backend_url: backendUrl,

  pb_url: env.NEXT_PUBLIC_PB_URL || "http://127.0.0.1:8090",

  jobs_webhook_enabled: enableJobsWebhook,
  jobs_url: env.NEXT_PUBLIC_JOBS_URL || "http://127.0.0.1:3001",

  default_bg_url: env.NEXT_PUBLIC_DEFAULT_BG_URL || "/dashboard-wallpaper.png",

  version: "1.0",

  allowInsecureCertsForIntegrationUrls: allowInsecureCertsForIntegrationUrls || false,
  enableSSO: enableSSOLogin,
  disableUserSignup: disableUserSignup
};

export default config;
