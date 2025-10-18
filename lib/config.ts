interface Config{
    pb_url: string;
    default_bg_url: string;
    version: string;
    allowInsecureCertsForIntegrationUrls: boolean;
    enableSSO: boolean;
    pbAdminEmail: string;
    pbAdminPassword: string;
}
const allowInsecureCertsForIntegrationUrls =
  process.env.INTEGRATIONS_ENABLE_SSL === 'true' ||
  process.env.INTEGRATIONS_ENABLE_SSL === '1';


const config: Config = {
  pb_url: process.env.NEXT_PUBLIC_PB_URL || 'http://127.0.0.1:8090',
  default_bg_url: process.env.DEFAULT_BG_URL || '/dashboard-wallpaper.png',
  version: 'maybenotthatwiseyet',
  allowInsecureCertsForIntegrationUrls: allowInsecureCertsForIntegrationUrls || false,
  enableSSO: process.env.ENABLE_SSO === 'true' || false,
  pbAdminEmail: process.env.PB_ADMIN_EMAIL || "",
  pbAdminPassword: process.env.PB_ADMIN_PASSWORD || ""
};

export default config;