interface Config {
  app_base_url: string;
  backend_url: string;
  pb_url: string;
  jobs_url?: string | undefined;
  jobs_webhook_enabled: boolean;
  default_bg_url: string;
  version: string;
  allowInsecureCertsForIntegrationUrls: boolean;
  enableSSO: boolean;
  pbAdminEmail: string;
  pbAdminPassword: string;
  disableUserSignup: boolean;
}

const env = import.meta.env;

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

  const backendUrl =
  env.NEXT_PUBLIC_BACKEND_URL ||
  (env.NODE_ENV === "development"
    ? "http://localhost:3000"
    : env.NEXT_PUBLIC_APP_URL || "http://localhost:3000");

const config: Config = {
  app_base_url: env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  backend_url: backendUrl,

  pb_url: env.NEXT_PUBLIC_PB_URL || "http://127.0.0.1:8090",

  jobs_webhook_enabled: enableJobsWebhook,
  jobs_url: env.NEXT_PUBLIC_JOBS_URL || "http://127.0.0.1:3001",

  default_bg_url: env.NEXT_PUBLIC_DEFAULT_BG_URL || "/dashboard-wallpaper.png",

  version: "0.5",

  allowInsecureCertsForIntegrationUrls: allowInsecureCertsForIntegrationUrls || false,
  enableSSO: enableSSOLogin,
  pbAdminEmail: env.PB_ADMIN_EMAIL || "",
  pbAdminPassword: env.PB_ADMIN_PASSWORD || "",
  disableUserSignup: disableUserSignup
};

export default config;
