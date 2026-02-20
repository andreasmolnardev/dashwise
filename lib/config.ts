interface Config {
  app_base_url: string;
  pb_url: string;
  jobs_url?: string | undefined;
  jobs_webhook_enabled: boolean;
  default_bg_url: string;
  version: string;
  buildDate: string;
  allowInsecureCertsForIntegrationUrls: boolean;
  enableSSO: boolean;
  pbAdminEmail: string;
  pbAdminPassword: string;
  disableUserSignup: boolean;
}
const allowInsecureCertsForIntegrationUrls =
  process.env.NEXT_PUBLIC_INTEGRATIONS_ENABLE_SSL === 'true' ||
  process.env.NEXT_PUBLIC_INTEGRATIONS_ENABLE_SSL === '1';

const enableSSOLogin =
  process.env.NEXT_PUBLIC_ENABLE_SSO === 'true' || process.env.NEXT_PUBLIC_ENABLE_SSO === '1' || false;

const disableUserSignup =
  process.env.NEXT_PUBLIC_DISABLE_USER_SIGNUP === 'true' || process.env.NEXT_PUBLIC_DISABLE_USER_SIGNUP === '1' || false;

const enableJobsWebhook =
  process.env.NEXT_PUBLIC_JOBS_WEBHOOK_ENABLE  === 'true' || process.env.NEXT_PUBLIC_JOBS_WEBHOOK_ENABLE === '1' || !!process.env.NEXT_PUBLIC_JOBS_URL || false;

const config: Config = {
  app_base_url: process.env.NEXT_PUBLIC_APP_URL || 'http://dashwise:3000',
  pb_url: process.env.NEXT_PUBLIC_PB_URL || 'http://127.0.0.1:8090',
  jobs_webhook_enabled: enableJobsWebhook,
  jobs_url: process.env.NEXT_PUBLIC_JOBS_URL || 'http://127.0.0.1:3001',
  default_bg_url: process.env.NEXT_PUBLIC_DEFAULT_BG_URL || '/dashboard-wallpaper.png',
  version: process.env.NEXT_PUBLIC_VERSION || '0.4-dev',
  buildDate: process.env.NEXT_PUBLIC_BUILD_DATE || new Date().toISOString(),
  allowInsecureCertsForIntegrationUrls: allowInsecureCertsForIntegrationUrls || false,
  enableSSO: enableSSOLogin,
  pbAdminEmail: process.env.PB_ADMIN_EMAIL || "",
  pbAdminPassword: process.env.PB_ADMIN_PASSWORD || "",
  disableUserSignup: disableUserSignup
};

export default config;
