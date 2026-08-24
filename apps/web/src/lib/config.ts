interface Config {
  instance_name?: string | undefined;
  backend_url: string;
  pb_url: string;
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
const isDev = Boolean(env.DEV);

const allowInsecureCertsForIntegrationUrls =
  env.NEXT_PUBLIC_INTEGRATIONS_ENABLE_SSL === "true" ||
  env.NEXT_PUBLIC_INTEGRATIONS_ENABLE_SSL === "1";

const enableSSOLogin =
  env.NEXT_PUBLIC_ENABLE_SSO === "true" || env.NEXT_PUBLIC_ENABLE_SSO === "1" || false;

const disableUserSignup =
  env.NEXT_PUBLIC_DISABLE_USER_SIGNUP === "true" || env.NEXT_PUBLIC_DISABLE_USER_SIGNUP === "1" || false;

let backend_url = 'http://localhost:3000';

if (!isDev){
  if (env.NEXT_PUBLIC_BACKEND_URL) {
    backend_url = env.NEXT_PUBLIC_BACKEND_URL;
  } else {
    backend_url = window.location.origin;
  }
}

const config: Config = {
  instance_name: env.INSTANCE_NAME || env.NEXT_PUBLIC_INSTANCE_NAME || "Dashwise",
  backend_url: backend_url,

  pb_url: env.NEXT_PUBLIC_PB_URL || "http://127.0.0.1:8090",

  default_bg_url: env.NEXT_PUBLIC_DEFAULT_BG_URL || "/dashboard-wallpaper.png",

  version: env.NEXT_PUBLIC_VERSION || "development",

  allowInsecureCertsForIntegrationUrls: allowInsecureCertsForIntegrationUrls || false,
  enableSSO: enableSSOLogin,
  disableUserSignup: disableUserSignup
};

export default config;
