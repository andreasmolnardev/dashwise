interface Config{
    app_base_url: string;
    pb_url: string;
    default_bg_url: string;
    version: string;
    allowInsecureCertsForIntegrationUrls: boolean;
    enableSSO: boolean;
    pbAdminEmail: string;
    pbAdminPassword: string;
}
const allowInsecureCertsForIntegrationUrls =
  process.env.NEXT_PUBLIC_INTEGRATIONS_ENABLE_SSL === 'true' ||
  process.env.NEXT_PUBLIC_INTEGRATIONS_ENABLE_SSL === '1';

const enableSSOLogin = 
  process.env.NEXT_PUBLIC_ENABLE_SSO === 'true' || process.env.NEXT_PUBLIC_ENABLE_SSO === '1' || false;

const config: Config = {
  app_base_url: process.env.NEXT_PUBLIC_APP_URL || 'http://dashwise:3000',
  pb_url: process.env.NEXT_PUBLIC_PB_URL || 'http://127.0.0.1:8090',
  default_bg_url: process.env.NEXT_PUBLIC_DEFAULT_BG_URL || '/dashboard-wallpaper.png',
  version: '0.3.1',
  allowInsecureCertsForIntegrationUrls: allowInsecureCertsForIntegrationUrls || false,
  enableSSO: enableSSOLogin,
  pbAdminEmail: process.env.PB_ADMIN_EMAIL || "",
  pbAdminPassword: process.env.PB_ADMIN_PASSWORD || ""
};

export default config;
